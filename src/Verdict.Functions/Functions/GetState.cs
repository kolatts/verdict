using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using System.Text.Json;
using Verdict.Functions.Domain;
using Verdict.Functions.Domain.Entities;

namespace Verdict.Functions.Functions;

/// <summary>
/// Returns the current game state for a given player.
/// This is the security-critical read path: the response is carefully projected
/// per-phase so players never receive information they shouldn't see yet.
///
/// Redaction rules:
///   LOBBY    — player list, lock status, can-start flag
///   ARGUMENT — take text, caller's OWN side only, submission count (not who submitted)
///   VOTE     — anonymized args (side + text + opaque argId, NO author names/guids)
///   REVEAL   — fully de-anonymized (authors, argued side vs real stance, vote tallies, contempt)
///   FINAL    — leaderboard + per-round contempt history
/// </summary>
public class GetState(GameService game)
{
    [Function("GetState")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "rooms/{code}/state")] HttpRequest req,
        string code)
    {
        var playerGuid = req.Query["playerGuid"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(playerGuid))
            return new BadRequestObjectResult(new { error = "playerGuid query param is required." });

        var roomCode = code.ToUpperInvariant();

        var room = await game.GetRoomAsync(roomCode);
        if (room is null)
            return new NotFoundObjectResult(new { error = "Room not found." });

        var players = await game.GetPlayersAsync(roomCode);
        var caller  = players.FirstOrDefault(p => p.RowKey == playerGuid);
        if (caller is null)
            return new UnauthorizedObjectResult(new { error = "Player not in this room." });

        var takes = JsonSerializer.Deserialize<string[]>(room.TakesJson) ?? [];

        return room.Phase switch
        {
            GamePhase.Lobby    => BuildLobbyState(room, players, caller),
            GamePhase.Argument => await BuildArgumentStateAsync(room, players, caller, takes),
            GamePhase.Vote     => await BuildVoteStateAsync(room, players, caller, takes),
            GamePhase.Reveal   => await BuildRevealStateAsync(room, players, caller, takes),
            GamePhase.Final    => await BuildFinalStateAsync(room, players, caller, takes),
            _                  => new ObjectResult(new { error = "Unknown phase." }) { StatusCode = 500 },
        };
    }

    // -------------------------------------------------------------------------
    // LOBBY
    // -------------------------------------------------------------------------

    private static IActionResult BuildLobbyState(
        RoomEntity room, List<PlayerEntity> players, PlayerEntity caller)
    {
        return new OkObjectResult(new
        {
            phase       = room.Phase,
            roomCode    = room.PartitionKey,
            locked      = room.Locked,
            totalRounds = room.TotalRounds,
            you = new { guid = caller.RowKey, name = caller.Name, isHost = caller.IsHost },
            players = players.Select(p => new { guid = p.RowKey, name = p.Name, isHost = p.IsHost }),
            canStart = caller.IsHost && players.Count >= 3 && room.Locked,
        });
    }

    // -------------------------------------------------------------------------
    // ARGUMENT — caller sees their own side; no one else's side
    // -------------------------------------------------------------------------

    private async Task<IActionResult> BuildArgumentStateAsync(
        RoomEntity room, List<PlayerEntity> players, PlayerEntity caller, string[] takes)
    {
        var args = await game.GetArgsForRoundAsync(room.PartitionKey, room.CurrentRound);
        var hasSubmitted = args.Any(a => a.PlayerGuid == caller.RowKey);
        var mySide = SideAssigner.Assign(room.RandSeed, room.CurrentRound, caller.RowKey);

        return new OkObjectResult(new
        {
            phase        = room.Phase,
            currentRound = room.CurrentRound,
            totalRounds  = room.TotalRounds,
            take         = takes.ElementAtOrDefault(room.CurrentRound),
            you = new
            {
                guid         = caller.RowKey,
                name         = caller.Name,
                score        = caller.Score,
                side         = mySide,                // ONLY the caller's own side
                hasSubmitted,
                isHost       = caller.IsHost,
            },
            submittedCount = args.Count,
            totalPlayers   = players.Count,
        });
    }

    // -------------------------------------------------------------------------
    // VOTE — args are anonymous (side + text + opaque ID, no author info)
    // -------------------------------------------------------------------------

    private async Task<IActionResult> BuildVoteStateAsync(
        RoomEntity room, List<PlayerEntity> players, PlayerEntity caller, string[] takes)
    {
        var args  = await game.GetArgsForRoundAsync(room.PartitionKey, room.CurrentRound);
        var votes = await game.GetVotesForRoundAsync(room.PartitionKey, room.CurrentRound);
        var hasVoted = votes.Any(v => v.VoterGuid == caller.RowKey);

        // NEVER expose playerGuid or author name during VOTE — only opaque argId + side + text
        var anonymizedArgs = args.Select(a => new
        {
            argId = a.OpaqueArgId,    // stable opaque ID: "arg-{round}-{guid[..8]}"
            side  = a.Side,
            text  = a.Text,
            // playerGuid is intentionally omitted
        });

        return new OkObjectResult(new
        {
            phase        = room.Phase,
            currentRound = room.CurrentRound,
            totalRounds  = room.TotalRounds,
            take         = takes.ElementAtOrDefault(room.CurrentRound),
            you = new
            {
                guid     = caller.RowKey,
                name     = caller.Name,
                score    = caller.Score,
                hasVoted,
                isHost   = caller.IsHost,
            },
            arguments    = anonymizedArgs,
            votedCount   = votes.Count,
            totalPlayers = players.Count,
        });
    }

    // -------------------------------------------------------------------------
    // REVEAL — full de-anonymization + scores + contempt
    // -------------------------------------------------------------------------

    private async Task<IActionResult> BuildRevealStateAsync(
        RoomEntity room, List<PlayerEntity> players, PlayerEntity caller, string[] takes)
    {
        var args  = await game.GetArgsForRoundAsync(room.PartitionKey, room.CurrentRound);
        var votes = await game.GetVotesForRoundAsync(room.PartitionKey, room.CurrentRound);

        // Vote tallies
        var votesFor = players.ToDictionary(p => p.RowKey, _ => 0);
        foreach (var v in votes)
            if (votesFor.ContainsKey(v.BestArgPlayerGuid))
                votesFor[v.BestArgPlayerGuid]++;

        // Contempt: players with zero best-arg votes this round
        var contemptGuids = votesFor
            .Where(kv => kv.Value == 0)
            .Select(kv => kv.Key)
            .ToList();

        // Build de-anonymized argument cards
        var playerMap = players.ToDictionary(p => p.RowKey);
        var revealedArgs = args.Select(a =>
        {
            playerMap.TryGetValue(a.PlayerGuid, out var author);
            // Show the voter's real stance for this player
            var voterEntry = votes.FirstOrDefault(v => v.VoterGuid == a.PlayerGuid);
            return new
            {
                authorGuid  = a.PlayerGuid,
                authorName  = author?.Name ?? "?",
                side        = a.Side,
                text        = a.Text,
                realStance  = voterEntry?.Stance,    // null if they didn't vote (shouldn't happen at reveal)
                bestArgVotes = votesFor.GetValueOrDefault(a.PlayerGuid),
            };
        });

        var isLastRound = room.CurrentRound >= room.TotalRounds - 1;

        return new OkObjectResult(new
        {
            phase        = room.Phase,
            currentRound = room.CurrentRound,
            totalRounds  = room.TotalRounds,
            take         = takes.ElementAtOrDefault(room.CurrentRound),
            you = new
            {
                guid   = caller.RowKey,
                name   = caller.Name,
                score  = caller.Score,
                isHost = caller.IsHost,
            },
            players = players.Select(p => new
            {
                guid          = p.RowKey,
                name          = p.Name,
                score         = p.Score,
                isHeldInContempt = contemptGuids.Contains(p.RowKey),
            }),
            arguments    = revealedArgs,
            contemptGuids,
            isLastRound,
        });
    }

    // -------------------------------------------------------------------------
    // FINAL — leaderboard
    // -------------------------------------------------------------------------

    private async Task<IActionResult> BuildFinalStateAsync(
        RoomEntity room, List<PlayerEntity> players, PlayerEntity caller, string[] takes)
    {
        // Collect contempt per round (all rounds 0..TotalRounds-1)
        var contemptByRound = new Dictionary<int, List<string>>();
        for (var r = 0; r < room.TotalRounds; r++)
        {
            var votes    = await game.GetVotesForRoundAsync(room.PartitionKey, r);
            var votesFor = players.ToDictionary(p => p.RowKey, _ => 0);
            foreach (var v in votes)
                if (votesFor.ContainsKey(v.BestArgPlayerGuid))
                    votesFor[v.BestArgPlayerGuid]++;

            contemptByRound[r] = votesFor
                .Where(kv => kv.Value == 0)
                .Select(kv => kv.Key)
                .ToList();
        }

        var leaderboard = players
            .OrderByDescending(p => p.Score)
            .ThenBy(p => p.JoinOrder)
            .Select((p, rank) => new
            {
                rank          = rank + 1,
                guid          = p.RowKey,
                name          = p.Name,
                score         = p.Score,
                contemptRounds = contemptByRound
                    .Where(kv => kv.Value.Contains(p.RowKey))
                    .Select(kv => kv.Key)
                    .ToList(),
            });

        return new OkObjectResult(new
        {
            phase       = room.Phase,
            totalRounds = room.TotalRounds,
            you = new { guid = caller.RowKey, name = caller.Name, score = caller.Score },
            leaderboard,
        });
    }
}
