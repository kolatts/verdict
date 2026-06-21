using Azure.Data.Tables;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.Azure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var builder = FunctionsApplication.CreateBuilder(args);

builder.ConfigureFunctionsWebApplication();

builder.Services.AddAzureClients(b =>
{
    b.AddTableServiceClient(builder.Configuration["TableConnection"]);
});

builder.Services.AddScoped<Verdict.Functions.Domain.GameService>();

var app = builder.Build();

// Create tables before app.Run() so they exist before the first request arrives.
// gRPC connects inside app.Run(), so the func host waits for this to finish.
// The func host's worker-start timeout is 60 s; Azurite responds in <1 s so
// this is well within budget.
var tables = app.Services.GetRequiredService<TableServiceClient>();
foreach (var name in new[] { "Rooms", "Players", "Args", "Votes", "Reactions" })
    await tables.CreateTableIfNotExistsAsync(name);

app.Run();
