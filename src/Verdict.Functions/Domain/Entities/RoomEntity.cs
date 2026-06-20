using Azure;
using Azure.Data.Tables;

namespace Verdict.Functions.Domain.Entities;

/// <summary>
/// One entity per room. PartitionKey = roomCode, RowKey = "ROOM".
/// This is the only row shared by all players; all writes use optimistic concurrency (ETag).
/// </summary>
public class RoomEntity : ITableEntity
{
    // ITableEntity
    public string PartitionKey { get; set; } = string.Empty; // roomCode
    public string RowKey { get; set; } = "ROOM";
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    public string HostGuid { get; set; } = string.Empty;

    /// <summary>LOBBY | ARGUMENT | VOTE | REVEAL | FINAL</summary>
    public string Phase { get; set; } = GamePhase.Lobby;

    /// <summary>0-based round index. -1 while in LOBBY.</summary>
    public int CurrentRound { get; set; } = -1;

    public int TotalRounds { get; set; }

    /// <summary>JSON-serialized string[] of hot-take text. Table Storage has no array type.</summary>
    public string TakesJson { get; set; } = "[]";

    /// <summary>Locked once the first non-host player joins. Prevents takes from being changed.</summary>
    public bool Locked { get; set; }

    /// <summary>
    /// Stable random seed (GUID string) generated at room creation.
    /// Used deterministically to assign Prosecution/Defense sides per (round, playerGuid).
    /// </summary>
    public string RandSeed { get; set; } = string.Empty;

    public DateTimeOffset CreatedUtc { get; set; }
}

public static class GamePhase
{
    public const string Lobby    = "LOBBY";
    public const string Argument = "ARGUMENT";
    public const string Vote     = "VOTE";
    public const string Reveal   = "REVEAL";
    public const string Final    = "FINAL";
}
