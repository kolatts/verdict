using System.Security.Cryptography;
using System.Text;

namespace Verdict.Functions.Domain;

public static class SideAssigner
{
    public const string Prosecution = "PROSECUTION";
    public const string Defense     = "DEFENSE";

    /// <summary>
    /// Deterministically assigns a side to a player for a given round.
    /// Inputs are stable (RandSeed stored on the room, round index, playerGuid),
    /// so this function returns the same value for every call with the same arguments —
    /// making it safe to recompute on every get-state poll without any stored randomness.
    /// </summary>
    public static string Assign(string randSeed, int round, string playerGuid)
    {
        var input = $"{randSeed}|{round}|{playerGuid}";
        var hash  = SHA256.HashData(Encoding.UTF8.GetBytes(input));
        return (hash[0] & 1) == 0 ? Prosecution : Defense;
    }
}
