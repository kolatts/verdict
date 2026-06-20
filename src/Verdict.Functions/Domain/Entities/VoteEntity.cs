using Azure;
using Azure.Data.Tables;

namespace Verdict.Functions.Domain.Entities;

/// <summary>
/// One entity per (voter, round) vote.
/// PartitionKey = roomCode, RowKey = "R{round}-V-{voterGuid}".
/// Each player writes only their own row — no contention.
/// </summary>
public class VoteEntity : ITableEntity
{
    public string PartitionKey { get; set; } = string.Empty; // roomCode
    public string RowKey { get; set; } = string.Empty;       // R{round}-V-{voterGuid}
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    public int Round { get; set; }
    public string VoterGuid { get; set; } = string.Empty;

    /// <summary>playerGuid of the player the voter chose as Best Argument.</summary>
    public string BestArgPlayerGuid { get; set; } = string.Empty;

    /// <summary>AGREE | DISAGREE — voter's real stance on the hot take.</summary>
    public string Stance { get; set; } = string.Empty;

    public DateTimeOffset CastUtc { get; set; }

    public static string BuildRowKey(int round, string voterGuid) => $"R{round}-V-{voterGuid}";
}

public static class Stance
{
    public const string Agree    = "AGREE";
    public const string Disagree = "DISAGREE";
}
