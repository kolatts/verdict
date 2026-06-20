using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using System.Text.Json;
using Verdict.Functions.Domain;

namespace Verdict.Functions.Functions;

public class AdvancePhase(GameService game)
{
    private record Request(string PlayerGuid);

    [Function("AdvancePhase")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "rooms/{code}/advance")] HttpRequest req,
        string code)
    {
        Request? body;
        try { body = await JsonSerializer.DeserializeAsync<Request>(req.Body, JsonOptions.Web); }
        catch { return new BadRequestObjectResult(new { error = "Invalid request body." }); }

        if (body is null || string.IsNullOrWhiteSpace(body.PlayerGuid))
            return new BadRequestObjectResult(new { error = "playerGuid is required." });

        try
        {
            var room = await game.AdvancePhaseAsync(code.ToUpperInvariant(), body.PlayerGuid);
            return new OkObjectResult(new { phase = room.Phase, currentRound = room.CurrentRound });
        }
        catch (GameException ex)
        {
            return new ObjectResult(new { error = ex.Message }) { StatusCode = ex.StatusCode };
        }
    }
}
