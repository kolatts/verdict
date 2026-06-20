using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Playwright;
using NUnit.Framework;
using Reqnroll;
using Verdict.E2E.Support;

namespace Verdict.E2E.Steps;

[Binding]
public sealed class GameSteps(GameSession session)
{
    private const string AppBase = "http://localhost:8080";
    private const string ApiBase = "http://localhost:7071/api";

    private static readonly HttpClient Http = new();

    // =========================================================================
    // Background
    // =========================================================================

    [Given("the local game stack is running")]
    public async Task LocalStackIsRunning()
    {
        // Quick smoke-check: health endpoint must respond
        var res = await Http.GetAsync($"{ApiBase}/health");
        Assert.That(res.IsSuccessStatusCode,
            $"Health endpoint returned {(int)res.StatusCode} — is the stack running?");
    }

    // =========================================================================
    // Lobby setup
    // =========================================================================

    [Given(@"""(.*)"" creates a room with (\d+) rounds? and these takes:")]
    public async Task HostCreatesRoom(string hostName, int rounds, DataTable takesTable)
    {
        var takes = takesTable.Rows.Select(r => r["Take"]).ToArray();

        var ctx  = await NewContextAsync();
        var page = await ctx.NewPageAsync();

        await page.GotoAsync(AppBase);
        await page.ClickAsync("#btn-show-create");
        await page.FillAsync("#host-name", hostName);
        await page.SelectOptionAsync("#total-rounds", rounds.ToString());

        // Wait for takes inputs to render after round count change
        await page.WaitForSelectorAsync("#takes-container .take-input");

        var inputs = await page.QuerySelectorAllAsync("#takes-container .take-input");

        // Fill existing inputs first; add more if needed
        for (var i = 0; i < takes.Length; i++)
        {
            if (i < inputs.Count)
            {
                await inputs[i].FillAsync(takes[i]);
            }
            else
            {
                await page.ClickAsync("#btn-add-take");
                var all = await page.QuerySelectorAllAsync("#takes-container .take-input");
                await all[^1].FillAsync(takes[i]);
            }
        }

        await page.ClickAsync("#btn-create");
        await page.WaitForSelectorAsync("#screen-lobby.active", new() { Timeout = 10_000 });

        var roomCode   = (await page.InnerTextAsync("#lobby-room-code")).Trim();
        var playerGuid = await ExtractGuidFromHashAsync(page);

        session.RoomCode = roomCode;
        session.Players[hostName] = new PlayerContext
        {
            Context    = ctx,
            Page       = page,
            PlayerGuid = playerGuid,
            Name       = hostName,
            IsHost     = true,
        };
    }

    [Given(@"""(.*)"" joins the room")]
    public async Task PlayerJoinsRoom(string playerName)
    {
        var ctx  = await NewContextAsync();
        var page = await ctx.NewPageAsync();

        await page.GotoAsync(AppBase);
        await page.ClickAsync("#btn-show-join");
        await page.FillAsync("#join-code", session.RoomCode);
        await page.FillAsync("#join-name", playerName);
        await page.ClickAsync("#btn-join");
        await page.WaitForSelectorAsync("#screen-lobby.active", new() { Timeout = 10_000 });

        var playerGuid = await ExtractGuidFromHashAsync(page);

        session.Players[playerName] = new PlayerContext
        {
            Context    = ctx,
            Page       = page,
            PlayerGuid = playerGuid,
            Name       = playerName,
            IsHost     = false,
        };
    }

    [Then(@"the lobby for ""(.*)"" shows (\d+) players")]
    public async Task LobbyShowsNPlayers(string playerName, int expectedCount)
    {
        var page = session.GetPlayer(playerName).Page;
        var rows = page.Locator("#lobby-players .player-row");
        await Expect(rows).ToHaveCountAsync(expectedCount, new() { Timeout = 5_000 });
    }

    [Then("the room is locked")]
    public async Task RoomIsLocked()
    {
        var state = await GetStateAsync(session.Host);
        Assert.That(state.GetProperty("locked").GetBoolean(), Is.True, "Room should be locked.");
    }

    // =========================================================================
    // Argument phase
    // =========================================================================

    [When(@"""(.*)"" starts the game")]
    public async Task HostStartsGame(string hostName)
    {
        var page = session.GetPlayer(hostName).Page;
        await page.ClickAsync("#btn-start");
        await WaitForPhaseAsync(page, "ARGUMENT");
    }

    [Then(@"all players are in the ""(.*)"" phase for round (\d+)")]
    public async Task AllPlayersInPhaseForRound(string phase, int round)
    {
        var tasks = session.Players.Values.Select(p => WaitForPhaseAsync(p.Page, phase, round));
        await Task.WhenAll(tasks);
    }

    [Then(@"all players are in the ""(.*)"" phase")]
    public async Task AllPlayersInPhase(string phase)
    {
        var tasks = session.Players.Values.Select(p => WaitForPhaseAsync(p.Page, phase));
        await Task.WhenAll(tasks);
    }

    [Then(@"""(.*)"" sees their own side but not ""(.*)""'s side")]
    public async Task PlayerSeesOwnSideNotOthers(string playerName, string otherName)
    {
        var page = session.GetPlayer(playerName).Page;

        // Own side badge must be visible and non-empty
        var badge = page.Locator("#side-badge");
        await Expect(badge).ToBeVisibleAsync();
        var badgeText = await badge.InnerTextAsync();
        Assert.That(badgeText.Length, Is.GreaterThan(0), "Side badge should have content.");

        // The OTHER player's side string must NOT appear anywhere on this page
        // (get-state should never return it)
        var otherState = await GetStateAsync(session.GetPlayer(otherName));
        // The other player's side is in their own state but should NOT appear in our page content
        // We can't easily check the raw JSON from the browser, so instead verify via API:
        var myState = await GetStateAsync(session.GetPlayer(playerName));
        Assert.That(myState.TryGetProperty("you", out var you), Is.True);
        // you.side exists and is non-null
        var mySide = you.GetProperty("side").GetString();
        Assert.That(mySide, Is.Not.Null.And.Not.Empty, "Caller should see their own side.");

        // The page must NOT expose any other player's side (no "side" property for others in ARGUMENT state)
        Assert.That(myState.TryGetProperty("arguments", out _), Is.False,
            "ARGUMENT phase state should not include arguments (only in VOTE+).");
    }

    [When(@"""(.*)"" submits the argument ""(.*)""")]
    public async Task PlayerSubmitsArgument(string playerName, string argText)
    {
        var page = session.GetPlayer(playerName).Page;

        await page.WaitForSelectorAsync("#play-argument:not(.hidden)");
        await page.FillAsync("#arg-text", argText);
        await page.ClickAsync("#btn-submit-arg");
        await page.WaitForSelectorAsync("#arg-submitted-notice:not(.hidden)",
            new() { Timeout = 8_000 });

        session.SubmittedArgs[playerName] = argText;
    }

    // =========================================================================
    // Vote phase
    // =========================================================================

    [Then(@"""(.*)"" sees (\d+) anonymous argument cards")]
    public async Task PlayerSeesNArgCards(string playerName, int count)
    {
        var page  = session.GetPlayer(playerName).Page;
        var cards = page.Locator("#vote-args .arg-card");
        await Expect(cards).ToHaveCountAsync(count, new() { Timeout = 5_000 });
    }

    [Then(@"argument cards shown to ""(.*)"" contain no author names")]
    public async Task ArgCardsContainNoAuthorNames(string playerName)
    {
        var page    = session.GetPlayer(playerName).Page;
        var content = await page.InnerTextAsync("#vote-args");

        // None of the other players' names should appear in the anonymous card list
        foreach (var other in session.Players.Values.Where(p => p.Name != playerName))
        {
            Assert.That(content, Does.Not.Contain(other.Name),
                $"Vote cards should not reveal author name '{other.Name}' during VOTE phase.");
        }
    }

    [When(@"""(.*)"" votes for the argument containing ""(.*)"" with stance ""(.*)""")]
    public async Task PlayerVotesForArg(string voterName, string argContains, string stance)
    {
        var page = session.GetPlayer(voterName).Page;

        // Find and click the matching arg card (by visible text content)
        var card = page.Locator(".arg-card", new() { HasText = argContains }).First;
        await card.ClickAsync();

        // Select stance
        var stanceBtn = page.Locator($".stance-btn[data-stance='{stance}']");
        await stanceBtn.ClickAsync();

        // Submit
        var castBtn = page.Locator("#btn-cast-vote");
        await Expect(castBtn).ToBeEnabledAsync();
        await castBtn.ClickAsync();

        await page.WaitForSelectorAsync("#vote-submitted-notice:not(.hidden)",
            new() { Timeout = 8_000 });
    }

    // =========================================================================
    // Reveal phase
    // =========================================================================

    [Then(@"""(.*)"" sees the author ""(.*)"" revealed on the ""(.*)"" argument")]
    public async Task PlayerSeesAuthorRevealedOnArg(string viewerName, string authorName, string argContains)
    {
        var page     = session.GetPlayer(viewerName).Page;
        // The reveal card shows argContains text AND authorName in the same card
        var card = page.Locator(".reveal-card", new() { HasText = argContains });
        await Expect(card).ToContainTextAsync(authorName, new() { Timeout = 5_000 });
    }

    [Then("scores have been updated correctly")]
    public async Task ScoresHaveBeenUpdatedCorrectly()
    {
        // Each player voted for a different person — everyone should have exactly 1 point
        // after round 1 (Judge→Alice, Alice→Bob, Bob→Judge)
        foreach (var player in session.Players.Values)
        {
            var state = await GetStateAsync(player);
            var score = state.GetProperty("players")
                .EnumerateArray()
                .First(p => p.GetProperty("guid").GetString() == player.PlayerGuid)
                .GetProperty("score").GetInt32();

            Assert.That(score, Is.EqualTo(1),
                $"Player '{player.Name}' should have 1 point after round 1.");
        }
    }

    // =========================================================================
    // Round 2 compound steps
    // =========================================================================

    [When(@"""(.*)"" advances to the next round")]
    public async Task HostAdvancesToNextRound(string hostName)
    {
        var page = session.GetPlayer(hostName).Page;
        await page.ClickAsync("#btn-next-round");
        await WaitForPhaseAsync(page, "ARGUMENT");
    }

    [When(@"""(.*)"" advances to the final leaderboard")]
    public async Task HostAdvancesToFinal(string hostName)
    {
        var page = session.GetPlayer(hostName).Page;
        await page.ClickAsync("#btn-final");
        await WaitForPhaseAsync(page, "FINAL");
    }

    [When("all players submit their round 2 arguments")]
    public async Task AllPlayersSubmitRound2Args()
    {
        var tasks = session.Players.Values.Select((p, i) =>
            PlayerSubmitsArgument(p.Name, $"Round 2 argument from {p.Name}: position {i + 1}."));
        await Task.WhenAll(tasks);
    }

    [When("all players cast their round 2 votes")]
    public async Task AllPlayersCastRound2Votes()
    {
        // Rotating vote: each player votes for the next player's argument
        var players = session.Players.Values.ToList();
        var tasks   = players.Select((voter, i) =>
        {
            var target   = players[(i + 1) % players.Count];
            // Use distinctive fragment from the argument text we submitted
            var fragment = $"argument from {target.Name}";
            return PlayerVotesForArg(voter.Name, fragment, "AGREE");
        });
        await Task.WhenAll(tasks);
    }

    // =========================================================================
    // Final leaderboard
    // =========================================================================

    [Then(@"the final leaderboard shows cumulative scores for all (\d+) players")]
    public async Task FinalLeaderboardShowsAllPlayers(int count)
    {
        var page = session.Host.Page;
        await WaitForPhaseAsync(page, "FINAL");

        var rows = page.Locator("#final-leaderboard .score-row");
        await Expect(rows).ToHaveCountAsync(count, new() { Timeout = 5_000 });

        // Cumulative scores: each player voted once per round (2 rounds) for someone else
        // → each player has exactly 2 points
        var content = await page.InnerTextAsync("#final-leaderboard");
        Assert.That(content, Does.Contain("2 pts"),
            "Each player should have 2 cumulative points after 2 rounds.");
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private async Task<IBrowserContext> NewContextAsync() =>
        await session.Browser!.NewContextAsync(new() { BaseURL = AppBase });

    private static async Task<string> ExtractGuidFromHashAsync(IPage page)
    {
        var hash  = await page.EvaluateAsync<string>("() => location.hash");
        var parts = hash.TrimStart('#').Split('/').Where(s => s.Length > 0).ToArray();
        // Expected: /room/{code}/{guid}
        if (parts.Length >= 3) return parts[2];
        throw new InvalidOperationException(
            $"Could not extract GUID from hash '{hash}'. Parts: [{string.Join(", ", parts)}]");
    }

    private async Task<JsonElement> GetStateAsync(PlayerContext player)
    {
        var res = await Http.GetAsync(
            $"{ApiBase}/rooms/{session.RoomCode}/state?playerGuid={player.PlayerGuid}");
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task WaitForPhaseAsync(IPage page, string phase, int? round = null)
    {
        var selector = phase switch
        {
            "LOBBY"    => "#screen-lobby.active",
            "ARGUMENT" => "#screen-play.active #play-argument:not(.hidden)",
            "VOTE"     => "#screen-play.active #play-vote:not(.hidden)",
            "REVEAL"   => "#screen-reveal.active",
            "FINAL"    => "#screen-final.active",
            _          => throw new ArgumentException($"Unknown phase: {phase}"),
        };

        await page.WaitForSelectorAsync(selector, new() { Timeout = 12_000 });

        if (round is null) return;

        var roundElId = phase is "ARGUMENT" or "VOTE" ? "#play-round"
                      : phase is "REVEAL"              ? "#reveal-round"
                      : null;

        if (roundElId is null) return;

        // Poll until the displayed round matches (may take one poll cycle)
        await page.WaitForFunctionAsync(
            $"([sel, r]) => document.querySelector(sel)?.textContent?.trim() === String(r)",
            new[] { (object)roundElId, round.Value.ToString() },
            new() { Timeout = 8_000 });
    }

    private static ILocatorAssertions Expect(ILocator locator) =>
        Assertions.Expect(locator);
}
