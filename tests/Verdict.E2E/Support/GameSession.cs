using Microsoft.Playwright;

namespace Verdict.E2E.Support;

/// <summary>
/// Scenario-scoped container holding all browser contexts for the current game.
/// Injected into step definitions and hooks via Reqnroll's DI.
/// </summary>
public sealed class GameSession : IAsyncDisposable
{
    public IPlaywright? Playwright { get; set; }
    public IBrowser? Browser      { get; set; }

    public string RoomCode { get; set; } = string.Empty;

    /// <summary>Keyed by player name (case-insensitive).</summary>
    public Dictionary<string, PlayerContext> Players { get; } =
        new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Text submitted per player this round, used to locate cards on the vote screen.</summary>
    public Dictionary<string, string> SubmittedArgs { get; } =
        new(StringComparer.OrdinalIgnoreCase);

    public PlayerContext Host =>
        Players.Values.First(p => p.IsHost);

    public PlayerContext GetPlayer(string name) =>
        Players.TryGetValue(name, out var ctx)
            ? ctx
            : throw new KeyNotFoundException($"No player named '{name}' in this session.");

    public async ValueTask DisposeAsync()
    {
        foreach (var player in Players.Values)
            await player.Context.DisposeAsync();

        if (Browser is not null)    await Browser.DisposeAsync();
        Playwright?.Dispose();
    }
}

public sealed class PlayerContext
{
    public required IBrowserContext Context    { get; init; }
    public required IPage           Page       { get; init; }
    public required string          PlayerGuid { get; set; }
    public required string          Name       { get; init; }
    public required bool            IsHost     { get; init; }
}
