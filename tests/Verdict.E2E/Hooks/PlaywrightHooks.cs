using Microsoft.Playwright;
using Reqnroll;
using Verdict.E2E.Support;

namespace Verdict.E2E.Hooks;

[Binding]
public sealed class PlaywrightHooks(GameSession session)
{
    [BeforeScenario]
    public async Task LaunchBrowser()
    {
        session.Playwright = await Playwright.CreateAsync();
        session.Browser    = await session.Playwright.Chromium.LaunchAsync(new()
        {
            Headless = true,
            SlowMo   = 0,
        });
    }

    [AfterScenario]
    public async Task CloseBrowser()
    {
        await session.DisposeAsync();
    }
}
