using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using System.Text.Json;
using Verdict.Functions.Domain;

namespace Verdict.Functions.Functions;

public class SubmitAction(GameService game)
{
    private record Request(string PlayerGuid, string Type, JsonElement Payload);

    [Function("SubmitAction")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "rooms/{code}/actions")] HttpRequest req,
        string code)
    {
        Request? body;
        try { body = await JsonSerializer.DeserializeAsync<Request>(req.Body, JsonOptions.Web); }
        catch { return new BadRequestObjectResult(new { error = "Invalid request body." }); }

        if (body is null || string.IsNullOrWhiteSpace(body.PlayerGuid))
            return new BadRequestObjectResult(new { error = "playerGuid is required." });

        var roomCode = code.ToUpperInvariant();

        try
        {
            switch (body.Type?.ToUpperInvariant())
            {
                case "SUBMIT_ARGUMENT":
                {
                    var text = body.Payload.TryGetProperty("text", out var t) ? t.GetString() : null;
                    if (string.IsNullOrEmpty(text))
                        return new BadRequestObjectResult(new { error = "text is required." });

                    await game.SubmitArgumentAsync(roomCode, body.PlayerGuid, text);
                    await game.TryAutoAdvanceAsync(roomCode);
                    return new OkObjectResult(new { ok = true });
                }

                case "CAST_VOTE":
                {
                    var bestArgId = body.Payload.TryGetProperty("bestArgId", out var b)
                        ? b.GetString() : null;
                    var stance = body.Payload.TryGetProperty("stance", out var s)
                        ? s.GetString() : null;

                    if (string.IsNullOrEmpty(bestArgId) || string.IsNullOrEmpty(stance))
                        return new BadRequestObjectResult(
                            new { error = "bestArgId and stance are required." });

                    await game.CastVoteAsync(roomCode, body.PlayerGuid, bestArgId, stance);
                    await game.TryAutoAdvanceAsync(roomCode);
                    return new OkObjectResult(new { ok = true });
                }

                default:
                    return new BadRequestObjectResult(
                        new { error = "type must be SUBMIT_ARGUMENT or CAST_VOTE." });
            }
        }
        catch (GameException ex)
        {
            return new ObjectResult(new { error = ex.Message }) { StatusCode = ex.StatusCode };
        }
    }
}
