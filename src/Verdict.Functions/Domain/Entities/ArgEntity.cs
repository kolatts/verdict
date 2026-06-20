using Azure;
using Azure.Data.Tables;

namespace Verdict.Functions.Domain.Entities;

/// <summary>
/// One entity per (player, round) argument.
/// PartitionKey = roomCode, RowKey = "R{round}-A-{playerGuid}".
/// Each player writes only their own row — no contention with other concurrent submitters.
/// </summary>
public class ArgEntity : ITableEntity
{
    public string PartitionKey { get; set; } = string.Empty; // roomCode
    public string RowKey { get; set; } = string.Empty;       // R{round}#A#{playerGuid}
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    public int Round { get; set; }
    public string PlayerGuid { get; set; } = string.Empty;

    /// <summary>PROSECUTION | DEFENSE — derived deterministically from RandSeed; persisted for convenience.</summary>
    public string Side { get; set; } = string.Empty;

    public string Text { get; set; } = string.Empty;

    public DateTimeOffset SubmittedUtc { get; set; }

    // Helpers
    public static string BuildRowKey(int round, string playerGuid) => $"R{round}-A-{playerGuid}";

    /// <summary>
    /// Opaque arg ID safe to expose to voting clients.
    /// Uses the playerGuid truncated to avoid leaking it directly while being stable per (round, player).
    /// Clients never get the full playerGuid during VOTE phase.
    /// </summary>
    public string OpaqueArgId => $"arg-{Round}-{PlayerGuid[..8]}";
}
