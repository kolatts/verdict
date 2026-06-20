using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using System.Text.Json;
using Verdict.Functions.Domain;

namespace Verdict.Functions.Functions;

public class JoinRoom(GameService game)
{
    private record Request(string Name);

    [Function("JoinRoom")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "rooms/{code}/players")] HttpRequest req,
        string code)
    {
        Request? body;
        try { body = await JsonSerializer.DeserializeAsync<Request>(req.Body, JsonOptions.Web); }
        catch { return new BadRequestObjectResult(new { error = "Invalid request body." }); }

        if (body is null || string.IsNullOrWhiteSpace(body.Name))
            return new BadRequestObjectResult(new { error = "name is required." });

        try
        {
            var playerGuid = await game.JoinRoomAsync(code.ToUpperInvariant(), body.Name.Trim());
            return new OkObjectResult(new { playerGuid });
        }
        catch (GameException ex)
        {
            return new ObjectResult(new { error = ex.Message }) { StatusCode = ex.StatusCode };
        }
    }
}
