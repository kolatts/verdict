using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Playwright;
using NUnit.Framework;
using Reqnroll;
using Verdict.E2E.Support;

namespace Verdict.E2E.Steps;

/// <summary>
/// Steps for the CharacterCounter feature.
/// These steps share a single "active player" context via scenario state.
/// </summary>
[Binding]
public sealed class CharCounterSteps(GameSession session)
{
    private const string AppBase = "http://localhost:8080";
    private const string ApiBase = "http://localhost:7071/api";

    private static readonly HttpClient Http = new();

    // Active player page used across steps in this scenario
    private IPage ActivePage => session.GetPlayer("TestPlayer").Page;

    // =========================================================================
    // Background shared setup — reuses GameSteps internals via API
    // =========================================================================

    [Given("a 3-player room is in the ARGUMENT phase")]
    public async Task ThreePlayerRoomInArgumentPhase()
    {
        // Spin up the room via API (faster than going through the UI)
        var createRes = await Http.PostAsJsonAsync($"{ApiBase}/rooms", new
        {
            hostName    = "TestPlayer",
            totalRounds = 1,
            takes       = new[] { "Open offices were a war crime" },
        });
        var createBody = await createRes.Content.ReadAsStringAsync();
        Assert.That(createRes.IsSuccessStatusCode, Is.True,
            $"create-room returned {(int)createRes.StatusCode}: {createBody}");
        var created = await createRes.Content.ReadFromJsonAsync<JsonElement>();

        var roomCode   = created.GetProperty("roomCode").GetString()!;
        var hostGuid   = created.GetProperty("playerGuid").GetString()!;
        session.RoomCode = roomCode;

        // Join two more players via API
        var join1 = await Http.PostAsJsonAsync($"{ApiBase}/rooms/{roomCode}/players",
            new { name = "P2" });
        var join2 = await Http.PostAsJsonAsync($"{ApiBase}/rooms/{roomCode}/players",
            new { name = "P3" });
        Assert.That(join1.IsSuccessStatusCode && join2.IsSuccessStatusCode, "joins must succeed.");

        // Advance to ARGUMENT via API
        var advance = await Http.PostAsJsonAsync($"{ApiBase}/rooms/{roomCode}/advance",
            new { playerGuid = hostGuid });
        Assert.That(advance.IsSuccessStatusCode, "advance to ARGUMENT must succeed.");

        // Open the host page in a browser so we can test the textarea
        var ctx  = await session.Browser!.NewContextAsync(new() { BaseURL = AppBase });
        var page = await ctx.NewPageAsync();

        await page.GotoAsync($"{AppBase}/#/room/{roomCode}/{hostGuid}");
        await page.WaitForSelectorAsync("#play-argument:not(.hidden)", new() { Timeout = 10_000 });

        session.Players["TestPlayer"] = new PlayerContext
        {
            Context    = ctx,
            Page       = page,
            PlayerGuid = hostGuid,
            Name       = "TestPlayer",
            IsHost     = true,
        };
    }

    // =========================================================================
    // Counter steps
    // =========================================================================

    [When(@"a player types (\d+) characters into the argument field")]
    public async Task TypeNChars(int n)
    {
        var text = new string('A', n);
        await ActivePage.FillAsync("#arg-text", text);
        await ActivePage.WaitForFunctionAsync(
            "n => document.getElementById('arg-char-count')?.textContent?.startsWith(n + ' ')",
            (object)n.ToString(), new() { Timeout = 3_000 });
    }

    [When(@"the player types (\d+) more characters")]
    public async Task TypeNMoreChars(int n)
    {
        // Read current value and append
        var current = await ActivePage.InputValueAsync("#arg-text");
        var updated = current + new string('B', n);
        await ActivePage.FillAsync("#arg-text", updated);
    }

    [When("the player types 1 more character")]
    public async Task TypeOneMoreChar()
    {
        var current = await ActivePage.InputValueAsync("#arg-text");
        await ActivePage.FillAsync("#arg-text", current + "Z");
    }

    [When("the player removes the last character")]
    public async Task RemoveLastChar()
    {
        var current = await ActivePage.InputValueAsync("#arg-text");
        if (current.Length > 0)
            await ActivePage.FillAsync("#arg-text", current[..^1]);
    }

    [Then(@"the character counter shows ""(.*)""")]
    public async Task CounterShows(string expected)
    {
        var counter = ActivePage.Locator("#arg-char-count");
        await Expect(counter).ToHaveTextAsync(expected, new() { Timeout = 3_000 });
    }

    [Then("the submit button is enabled")]
    public async Task SubmitIsEnabled()
    {
        var btn = ActivePage.Locator("#btn-submit-arg");
        await Expect(btn).ToBeEnabledAsync(new() { Timeout = 2_000 });
    }

    [Then("the submit button is disabled")]
    public async Task SubmitIsDisabled()
    {
        var btn = ActivePage.Locator("#btn-submit-arg");
        await Expect(btn).ToBeDisabledAsync(new() { Timeout = 2_000 });
    }

    [Then(@"the character counter is in the ""(.*)"" state")]
    public async Task CounterIsInState(string state)
    {
        var counter = ActivePage.Locator("#arg-char-count");
        if (state == "over-limit")
        {
            await Expect(counter).ToHaveClassAsync(
                new System.Text.RegularExpressions.Regex("over"), new() { Timeout = 2_000 });
        }
    }

    // =========================================================================
    // API validation step
    // =========================================================================

    [When(@"a player directly submits a (\d+)-character argument via the API")]
    public async Task DirectApiSubmitNChars(int n)
    {
        var text = new string('X', n);
        var player = session.GetPlayer("TestPlayer");
        var res = await Http.PostAsJsonAsync($"{ApiBase}/rooms/{session.RoomCode}/actions", new
        {
            playerGuid = player.PlayerGuid,
            type       = "SUBMIT_ARGUMENT",
            payload    = new { text },
        });

        // Store status for the Then step
        session.Players["TestPlayer"].PlayerGuid += $"|last_status={(int)res.StatusCode}";
        // We abuse PlayerGuid to pass the status — override with a cleaner field via ScenarioContext
        // but for simplicity store in a static field scoped to this scenario
        _lastApiStatus = (int)res.StatusCode;
        _lastApiBody   = await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static int _lastApiStatus;
    private static JsonElement _lastApiBody;

    [Then(@"the API returns status (\d+)")]
    public void ApiReturnsStatus(int expected)
    {
        Assert.That(_lastApiStatus, Is.EqualTo(expected),
            $"Expected HTTP {expected} but got {_lastApiStatus}.");
    }

    [Then("the error message mentions the character limit")]
    public void ErrorMentionsCharLimit()
    {
        Assert.That(_lastApiBody.TryGetProperty("error", out var err), Is.True);
        var msg = err.GetString() ?? string.Empty;
        Assert.That(msg, Does.Contain("280").Or.Contain("character").IgnoreCase,
            $"Expected error to mention char limit, got: {msg}");
    }

    private static ILocatorAssertions Expect(ILocator loc) => Assertions.Expect(loc);
}
