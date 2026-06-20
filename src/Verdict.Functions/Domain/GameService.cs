using Azure;
using Azure.Data.Tables;
using System.Text.Json;
using Verdict.Functions.Domain.Entities;

namespace Verdict.Functions.Domain;

/// <summary>
/// Core game logic: room creation, joining, phase transitions, auto-advance, scoring.
/// All state lives in Azure Table Storage. Phase transitions use an optimistic concurrency
/// retry loop on the Rooms row (the only row shared by all players).
/// </summary>
public class GameService(TableServiceClient tableService)
{
    // Table constants
    private const string TableRooms   = "Rooms";
    private const string TablePlayers = "Players";
    private const string TableArgs    = "Args";
    private const string TableVotes   = "Votes";

    // Argument character limits — shared source of truth (mirrors MaxArgChars in app.js)
    public const int MinArgChars = 1;
    public const int MaxArgChars = 280;

    // Room code alphabet (avoids 0/O and 1/I confusion)
    private const string RoomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private const int    RoomCodeLength   = 4;

    private TableClient Rooms   => tableService.GetTableClient(TableRooms);
    private TableClient Players => tableService.GetTableClient(TablePlayers);
    private TableClient Args    => tableService.GetTableClient(TableArgs);
    private TableClient Votes   => tableService.GetTableClient(TableVotes);

    // -------------------------------------------------------------------------
    // Create room
    // -------------------------------------------------------------------------

    public async Task<(string roomCode, string playerGuid)> CreateRoomAsync(
        string hostName, int totalRounds, IReadOnlyList<string> takes)
    {
        var roomCode   = await GenerateUniqueRoomCodeAsync();
        var hostGuid   = Guid.NewGuid().ToString("N");
        var randSeed   = Guid.NewGuid().ToString("N");

        var room = new RoomEntity
        {
            PartitionKey = roomCode,
            RowKey       = "ROOM",
            HostGuid     = hostGuid,
            Phase        = GamePhase.Lobby,
            CurrentRound = -1,
            TotalRounds  = totalRounds,
            TakesJson    = JsonSerializer.Serialize(takes),
            Locked       = false,
            RandSeed     = randSeed,
            CreatedUtc   = DateTimeOffset.UtcNow,
        };

        var host = new PlayerEntity
        {
            PartitionKey = roomCode,
            RowKey       = hostGuid,
            Name         = hostName,
            Score        = 0,
            JoinOrder    = 0,
            IsHost       = true,
            JoinedUtc    = DateTimeOffset.UtcNow,
        };

        await Rooms.AddEntityAsync(room);
        await Players.AddEntityAsync(host);

        return (roomCode, hostGuid);
    }

    // -------------------------------------------------------------------------
    // Join room
    // -------------------------------------------------------------------------

    public async Task<string> JoinRoomAsync(string roomCode, string name)
    {
        var room = await GetRoomAsync(roomCode)
            ?? throw new GameException("Room not found.", 404);

        if (room.Phase != GamePhase.Lobby)
            throw new GameException("Game already in progress.", 409);

        // Count existing players to assign join order
        var existingPlayers = await GetPlayersAsync(roomCode);

        if (existingPlayers.Any(p => p.Name.Equals(name, StringComparison.OrdinalIgnoreCase)))
            throw new GameException("Name already taken.", 409);

        var playerGuid = Guid.NewGuid().ToString("N");
        var player = new PlayerEntity
        {
            PartitionKey = roomCode,
            RowKey       = playerGuid,
            Name         = name,
            Score        = 0,
            JoinOrder    = existingPlayers.Count,
            IsHost       = false,
            JoinedUtc    = DateTimeOffset.UtcNow,
        };

        await Players.AddEntityAsync(player);

        // Lock the room once the first non-host player joins
        if (!room.Locked)
        {
            await OptimisticUpdateRoomAsync(roomCode, r =>
            {
                if (r.Locked) return false; // already locked
                r.Locked = true;
                return true;
            });
        }

        return playerGuid;
    }

    // -------------------------------------------------------------------------
    // Advance phase (host-driven and auto-advance path both use this)
    // -------------------------------------------------------------------------

    public async Task<RoomEntity> AdvancePhaseAsync(string roomCode, string callerGuid)
    {
        var room = await GetRoomAsync(roomCode)
            ?? throw new GameException("Room not found.", 404);

        var players = await GetPlayersAsync(roomCode);
        var host    = players.FirstOrDefault(p => p.IsHost)
            ?? throw new GameException("Host not found.", 500);

        return room.Phase switch
        {
            GamePhase.Lobby when callerGuid == host.RowKey =>
                await AdvanceLobbyToArgumentAsync(roomCode, players),

            GamePhase.Reveal when callerGuid == host.RowKey =>
                await AdvanceRevealAsync(roomCode, room, players),

            _ => throw new GameException($"Cannot advance from phase {room.Phase} as this caller.", 403),
        };
    }

    /// <summary>Called internally after a submit-action lands the last arg/vote.</summary>
    public async Task TryAutoAdvanceAsync(string roomCode)
    {
        var room    = await GetRoomAsync(roomCode);
        if (room is null) return;

        var players = await GetPlayersAsync(roomCode);
        var n       = players.Count;

        if (room.Phase == GamePhase.Argument)
        {
            var argCount = await CountArgsForRoundAsync(roomCode, room.CurrentRound);
            if (argCount >= n)
                await OptimisticUpdateRoomAsync(roomCode, r =>
                {
                    if (r.Phase != GamePhase.Argument) return false;
                    r.Phase = GamePhase.Vote;
                    return true;
                });
        }
        else if (room.Phase == GamePhase.Vote)
        {
            var voteCount = await CountVotesForRoundAsync(roomCode, room.CurrentRound);
            if (voteCount >= n)
            {
                // Only the call that wins the ETag race should tally scores.
                // All concurrent TryAutoAdvance calls see voteCount >= n, so only one must tally.
                var wonRace = false;
                await OptimisticUpdateRoomAsync(roomCode, r =>
                {
                    if (r.Phase != GamePhase.Vote) { wonRace = false; return false; }
                    wonRace = true;
                    r.Phase = GamePhase.Reveal;
                    return true;
                });
                if (wonRace)
                    await TallyRoundAsync(roomCode, room.CurrentRound, players);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Submit argument
    // -------------------------------------------------------------------------

    public async Task SubmitArgumentAsync(string roomCode, string playerGuid, string text)
    {
        var trimmed = text.Trim();
        if (trimmed.Length < MinArgChars || trimmed.Length > MaxArgChars)
            throw new GameException(
                $"Argument must be between {MinArgChars} and {MaxArgChars} characters.", 400);

        var room = await GetRoomAsync(roomCode)
            ?? throw new GameException("Room not found.", 404);

        if (room.Phase != GamePhase.Argument)
            throw new GameException("Not in argument phase.", 409);

        var side = SideAssigner.Assign(room.RandSeed, room.CurrentRound, playerGuid);

        var arg = new ArgEntity
        {
            PartitionKey  = roomCode,
            RowKey        = ArgEntity.BuildRowKey(room.CurrentRound, playerGuid),
            Round         = room.CurrentRound,
            PlayerGuid    = playerGuid,
            Side          = side,
            Text          = trimmed,
            SubmittedUtc  = DateTimeOffset.UtcNow,
        };

        // Upsert: idempotent — a double-submit just overwrites with the same player's data
        await Args.UpsertEntityAsync(arg, TableUpdateMode.Replace);
    }

    // -------------------------------------------------------------------------
    // Cast vote
    // -------------------------------------------------------------------------

    /// <summary>
    /// Casts a vote. <paramref name="bestArgId"/> is the opaque arg ID returned by get-state
    /// during the VOTE phase (e.g. "arg-0-a3f9c12b"). The server resolves it to a playerGuid
    /// so the client never needs to know who wrote which argument.
    /// </summary>
    public async Task CastVoteAsync(string roomCode, string voterGuid, string bestArgId, string stance)
    {
        if (stance != Entities.Stance.Agree && stance != Entities.Stance.Disagree)
            throw new GameException("Invalid stance.", 400);

        var room = await GetRoomAsync(roomCode)
            ?? throw new GameException("Room not found.", 404);

        if (room.Phase != GamePhase.Vote)
            throw new GameException("Not in voting phase.", 409);

        // Resolve opaque argId → playerGuid (the client never sees the playerGuid during VOTE)
        var roundArgs = await GetArgsForRoundAsync(roomCode, room.CurrentRound);
        var targetArg = roundArgs.FirstOrDefault(a => a.OpaqueArgId == bestArgId)
            ?? throw new GameException("Invalid argument selection.", 400);

        if (voterGuid == targetArg.PlayerGuid)
            throw new GameException("Cannot vote for yourself.", 400);

        var vote = new VoteEntity
        {
            PartitionKey       = roomCode,
            RowKey             = VoteEntity.BuildRowKey(room.CurrentRound, voterGuid),
            Round              = room.CurrentRound,
            VoterGuid          = voterGuid,
            BestArgPlayerGuid  = targetArg.PlayerGuid,
            Stance             = stance,
            CastUtc            = DateTimeOffset.UtcNow,
        };

        await Votes.UpsertEntityAsync(vote, TableUpdateMode.Replace);
    }

    // -------------------------------------------------------------------------
    // Scoring (runs exactly once, guarded by phase transition retry loop)
    // -------------------------------------------------------------------------

    private async Task TallyRoundAsync(string roomCode, int round, List<PlayerEntity> players)
    {
        var votes = await GetVotesForRoundAsync(roomCode, round);

        // Tally best-arg votes per player
        var voteCounts = players.ToDictionary(p => p.RowKey, _ => 0);
        foreach (var v in votes)
        {
            if (voteCounts.ContainsKey(v.BestArgPlayerGuid))
                voteCounts[v.BestArgPlayerGuid]++;
        }

        // Update each player's cumulative score (own row, no contention)
        foreach (var player in players)
        {
            var delta = voteCounts.GetValueOrDefault(player.RowKey);
            if (delta > 0)
            {
                player.Score += delta;
                await Players.UpdateEntityAsync(player, player.ETag, TableUpdateMode.Replace);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Phase transition helpers
    // -------------------------------------------------------------------------

    private async Task<RoomEntity> AdvanceLobbyToArgumentAsync(string roomCode, List<PlayerEntity> players)
    {
        if (players.Count < 3)
            throw new GameException("Need at least 3 players to start.", 409);

        return await OptimisticUpdateRoomAsync(roomCode, r =>
        {
            if (r.Phase != GamePhase.Lobby) return false;
            r.Phase        = GamePhase.Argument;
            r.CurrentRound = 0;
            return true;
        });
    }

    private async Task<RoomEntity> AdvanceRevealAsync(string roomCode, RoomEntity room, List<PlayerEntity> players)
    {
        var nextRound = room.CurrentRound + 1;
        var isLastRound = nextRound >= room.TotalRounds;

        return await OptimisticUpdateRoomAsync(roomCode, r =>
        {
            if (r.Phase != GamePhase.Reveal) return false;
            if (isLastRound)
            {
                r.Phase = GamePhase.Final;
            }
            else
            {
                r.Phase        = GamePhase.Argument;
                r.CurrentRound = nextRound;
            }
            return true;
        });
    }

    // -------------------------------------------------------------------------
    // Optimistic concurrency: read-modify-write with ETag retry
    // -------------------------------------------------------------------------

    private async Task<RoomEntity> OptimisticUpdateRoomAsync(
        string roomCode, Func<RoomEntity, bool> mutate, int maxAttempts = 5)
    {
        for (var attempt = 0; attempt < maxAttempts; attempt++)
        {
            var response = await Rooms.GetEntityAsync<RoomEntity>(roomCode, "ROOM");
            var room     = response.Value;

            // Guard: if mutate returns false, state is already correct — idempotent no-op
            if (!mutate(room)) return room;

            try
            {
                await Rooms.UpdateEntityAsync(room, room.ETag, TableUpdateMode.Replace);
                return room;
            }
            catch (RequestFailedException ex) when (ex.Status == 412)
            {
                // ETag mismatch — another writer beat us. Re-read and re-evaluate.
                if (attempt == maxAttempts - 1) throw;
                await Task.Delay(TimeSpan.FromMilliseconds(50 * (attempt + 1)));
            }
        }

        throw new InvalidOperationException("Failed to update room after retries.");
    }

    // -------------------------------------------------------------------------
    // Read helpers
    // -------------------------------------------------------------------------

    public async Task<RoomEntity?> GetRoomAsync(string roomCode)
    {
        try
        {
            var r = await Rooms.GetEntityAsync<RoomEntity>(roomCode, "ROOM");
            return r.Value;
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            return null;
        }
    }

    public async Task<List<PlayerEntity>> GetPlayersAsync(string roomCode)
    {
        var results = new List<PlayerEntity>();
        await foreach (var p in Players.QueryAsync<PlayerEntity>(
            p => p.PartitionKey == roomCode))
        {
            results.Add(p);
        }
        return results.OrderBy(p => p.JoinOrder).ToList();
    }

    public async Task<List<ArgEntity>> GetArgsForRoundAsync(string roomCode, int round)
    {
        var prefix  = $"R{round}-A-";
        var results = new List<ArgEntity>();
        await foreach (var a in Args.QueryAsync<ArgEntity>(
            a => a.PartitionKey == roomCode && a.RowKey.CompareTo(prefix) >= 0
                                            && a.RowKey.CompareTo(prefix + "￿") <= 0))
        {
            if (a.Round == round) results.Add(a);
        }
        return results;
    }

    public async Task<List<VoteEntity>> GetVotesForRoundAsync(string roomCode, int round)
    {
        var prefix  = $"R{round}-V-";
        var results = new List<VoteEntity>();
        await foreach (var v in Votes.QueryAsync<VoteEntity>(
            v => v.PartitionKey == roomCode && v.RowKey.CompareTo(prefix) >= 0
                                            && v.RowKey.CompareTo(prefix + "￿") <= 0))
        {
            if (v.Round == round) results.Add(v);
        }
        return results;
    }

    private async Task<int> CountArgsForRoundAsync(string roomCode, int round)
        => (await GetArgsForRoundAsync(roomCode, round)).Count;

    private async Task<int> CountVotesForRoundAsync(string roomCode, int round)
        => (await GetVotesForRoundAsync(roomCode, round)).Count;

    // -------------------------------------------------------------------------
    // Room code generation
    // -------------------------------------------------------------------------

    private async Task<string> GenerateUniqueRoomCodeAsync()
    {
        for (var i = 0; i < 10; i++)
        {
            var code = GenerateRoomCode();
            var existing = await Rooms.GetEntityIfExistsAsync<RoomEntity>(code, "ROOM");
            if (!existing.HasValue) return code;
        }
        throw new InvalidOperationException("Could not generate a unique room code.");
    }

    private static string GenerateRoomCode()
    {
        var chars = new char[RoomCodeLength];
        var bytes = new byte[RoomCodeLength];
        Random.Shared.NextBytes(bytes);
        for (var i = 0; i < RoomCodeLength; i++)
            chars[i] = RoomCodeAlphabet[bytes[i] % RoomCodeAlphabet.Length];
        return new string(chars);
    }
}

// -------------------------------------------------------------------------
// Exception type for game errors that map to HTTP status codes
// -------------------------------------------------------------------------

public class GameException(string message, int statusCode) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}
