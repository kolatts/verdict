using Reqnroll;
using Verdict.E2E.Support;

namespace Verdict.E2E.Hooks;

/// <summary>
/// Takes a screenshot after every step and captures a full-page screenshot
/// when a scenario fails. Screenshots land in TestResults/screenshots/.
/// </summary>
[Binding]
public sealed class ScreenshotHooks(GameSession session, ScenarioContext scenarioContext)
{
    private static readonly string OutputDir =
        Path.Combine(AppContext.BaseDirectory, "TestResults", "screenshots");

    private int _stepIndex;

    [BeforeScenario(Order = 0)]
    public void CreateOutputDir()
    {
        Directory.CreateDirectory(OutputDir);
        _stepIndex = 0;
    }

    [AfterStep]
    public async Task ScreenshotAfterStep()
    {
        _stepIndex++;

        var stepTitle = scenarioContext.StepContext.StepInfo.Text
            .Replace("/", "-")
            .Replace("\\", "-")
            .Replace("\"", "")
            .Replace(":", "")
            .Trim();

        if (stepTitle.Length > 60)
            stepTitle = stepTitle[..60];

        var scenarioSlug = Slugify(scenarioContext.ScenarioInfo.Title);
        var dir          = Path.Combine(OutputDir, scenarioSlug);
        Directory.CreateDirectory(dir);

        var suffix = scenarioContext.TestError is null ? "ok" : "FAIL";
        var name   = $"{_stepIndex:D2}_{suffix}_{stepTitle}.png";
        var path   = Path.Combine(dir, name);

        // Capture each player's page
        foreach (var player in session.Players.Values)
        {
            var playerPath = path.Replace(".png", $"_{Slugify(player.Name)}.png");
            try
            {
                await player.Page.ScreenshotAsync(new()
                {
                    Path     = playerPath,
                    FullPage = true,
                });
            }
            catch
            {
                // Page may be closed — best effort
            }
        }
    }

    [AfterScenario]
    public async Task ScreenshotOnFailure()
    {
        if (scenarioContext.TestError is null) return;

        var scenarioSlug = Slugify(scenarioContext.ScenarioInfo.Title);
        var dir          = Path.Combine(OutputDir, scenarioSlug);
        Directory.CreateDirectory(dir);

        foreach (var player in session.Players.Values)
        {
            var path = Path.Combine(dir, $"FAILED_{Slugify(player.Name)}.png");
            try
            {
                await player.Page.ScreenshotAsync(new()
                {
                    Path     = path,
                    FullPage = true,
                });
            }
            catch { /* best effort */ }
        }
    }

    private static string Slugify(string s) =>
        System.Text.RegularExpressions.Regex
            .Replace(s, @"[^\w\-]", "_")
            .Trim('_')[..Math.Min(s.Length, 80)];
}
