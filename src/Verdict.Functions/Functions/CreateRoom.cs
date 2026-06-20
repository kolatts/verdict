using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using System.Text.Json;
using Verdict.Functions.Domain;

namespace Verdict.Functions.Functions;

public class CreateRoom(GameService game)
{
    private record Request(string HostName, int TotalRounds, string[] Takes);

    [Function("CreateRoom")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "rooms")] HttpRequest req)
    {
        Request? body;
        try { body = await JsonSerializer.DeserializeAsync<Request>(req.Body, JsonOptions.Web); }
        catch { return new BadRequestObjectResult(new { error = "Invalid request body." }); }

        if (body is null || string.IsNullOrWhiteSpace(body.HostName))
            return new BadRequestObjectResult(new { error = "hostName is required." });

        if (body.TotalRounds is < 1 or > 10)
            return new BadRequestObjectResult(new { error = "totalRounds must be between 1 and 10." });

        if (body.Takes is null || body.Takes.Length == 0 || body.Takes.Length < body.TotalRounds)
            return new BadRequestObjectResult(new { error = "takes must include at least one entry per round." });

        try
        {
            var (roomCode, playerGuid) = await game.CreateRoomAsync(
                body.HostName.Trim(), body.TotalRounds, body.Takes);

            return new OkObjectResult(new { roomCode, playerGuid });
        }
        catch (GameException ex)
        {
            return new ObjectResult(new { error = ex.Message }) { StatusCode = ex.StatusCode };
        }
    }
}
