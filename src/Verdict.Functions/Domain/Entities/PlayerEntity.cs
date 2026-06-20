using Azure;
using Azure.Data.Tables;

namespace Verdict.Functions.Domain.Entities;

/// <summary>
/// One entity per player. PartitionKey = roomCode, RowKey = playerGuid.
/// Each player owns their row exclusively — no ETag contention from other players.
/// </summary>
public class PlayerEntity : ITableEntity
{
    public string PartitionKey { get; set; } = string.Empty; // roomCode
    public string RowKey { get; set; } = string.Empty;       // playerGuid
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary>Cumulative Best Argument points across all rounds.</summary>
    public int Score { get; set; }

    /// <summary>Monotonically increasing join order. Used for display ordering.</summary>
    public int JoinOrder { get; set; }

    public bool IsHost { get; set; }

    public DateTimeOffset JoinedUtc { get; set; }
}
