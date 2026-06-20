using System.Diagnostics;
using System.Net.Sockets;
using Reqnroll;

namespace Verdict.E2E.Hooks;

/// <summary>
/// Starts the local dev stack before the test run (Azurite + Functions host + static server)
/// and tears it down after. If CI_SERVERS_RUNNING=true, servers are assumed to already be
/// running (e.g. started by the CI workflow) and this hook is skipped.
/// </summary>
[Binding]
public static class WebServerHooks
{
    private static readonly string RepoRoot        = FindRepoRoot();
    private static readonly string FunctionsDir    = Path.Combine(RepoRoot, "src", "Verdict.Functions");
    private static readonly string DocsDir         = Path.Combine(RepoRoot, "docs");
    private static readonly string AzuriteDataDir  = Path.Combine(RepoRoot, ".azurite-test");

    private static Process? _azurite;
    private static Process? _funcHost;
    private static Process? _staticServer;

    [BeforeTestRun]
    public static async Task StartDevServers()
    {
        if (Environment.GetEnvironmentVariable("CI_SERVERS_RUNNING") == "true")
            return;

        Directory.CreateDirectory(AzuriteDataDir);

        _azurite = Launch("azurite",
            $"--silent --location \"{AzuriteDataDir}\"",
            RepoRoot);

        // Wait for all three Azurite services — Blob (10000), Queue (10001), Table (10002).
        // We only need Table Storage, but checking all three ensures Azurite is fully up.
        await WaitForPortAsync(10000, "Azurite (Blob)",  TimeSpan.FromSeconds(15));
        await WaitForPortAsync(10001, "Azurite (Queue)", TimeSpan.FromSeconds(5));
        await WaitForPortAsync(10002, "Azurite (Table)", TimeSpan.FromSeconds(5));

        _funcHost = Launch("func",
            "start",
            FunctionsDir,
            new Dictionary<string, string>
            {
                ["AzureWebJobsStorage"]    = "UseDevelopmentStorage=true",
                ["TableConnection"]        = "UseDevelopmentStorage=true",
                ["FUNCTIONS_WORKER_RUNTIME"] = "dotnet-isolated",
            });

        await WaitForPortAsync(7071, "Azure Functions", TimeSpan.FromSeconds(90));
        await WaitForHttpAsync("http://localhost:7071/api/health", "Azure Functions worker", TimeSpan.FromSeconds(30));

        _staticServer = Launch("http-server",
            ". -p 8080 -c-1 --silent",
            DocsDir);

        await WaitForPortAsync(8080, "Static HTTP server", TimeSpan.FromSeconds(10));
    }

    [AfterTestRun]
    public static void StopDevServers()
    {
        if (Environment.GetEnvironmentVariable("CI_SERVERS_RUNNING") == "true")
            return;

        Kill(_azurite);
        Kill(_funcHost);
        Kill(_staticServer);
    }

    // -------------------------------------------------------------------------

    private static Process Launch(
        string command, string args, string workDir,
        Dictionary<string, string>? env = null)
    {
        // On Windows, npm global tools are .cmd scripts; UseShellExecute=false bypasses
        // the shell and can't find them. Wrap with cmd.exe /c so PATH resolution works.
        ProcessStartInfo psi;
        if (OperatingSystem.IsWindows())
        {
            psi = new ProcessStartInfo("cmd.exe", $"/c {command} {args}")
            {
                WorkingDirectory       = workDir,
                UseShellExecute        = false,
                RedirectStandardOutput = true,
                RedirectStandardError  = true,
                CreateNoWindow         = true,
            };
        }
        else
        {
            psi = new ProcessStartInfo(command, args)
            {
                WorkingDirectory       = workDir,
                UseShellExecute        = false,
                RedirectStandardOutput = true,
                RedirectStandardError  = true,
            };
        }

        if (env is not null)
            foreach (var kv in env)
                psi.Environment[kv.Key] = kv.Value;

        var p = Process.Start(psi)
            ?? throw new InvalidOperationException($"Failed to start '{command}'.");

        // Consume stdout/stderr asynchronously so the OS pipe buffer never fills and
        // blocks the child process from writing (which would deadlock it under heavy output
        // like MSBuild during `func start`).
        p.OutputDataReceived += (_, _) => { };
        p.ErrorDataReceived  += (_, _) => { };
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();

        return p;
    }

    private static async Task WaitForPortAsync(int port, string name, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                using var client = new TcpClient();
                await client.ConnectAsync("127.0.0.1", port);
                return;
            }
            catch
            {
                await Task.Delay(500);
            }
        }
        throw new TimeoutException($"{name} (port {port}) did not become available within {timeout}.");
    }

    private static async Task WaitForHttpAsync(string url, string name, TimeSpan timeout)
    {
        using var http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var res = await http.GetAsync(url);
                if (res.IsSuccessStatusCode) return;
            }
            catch { }
            await Task.Delay(500);
        }
        throw new TimeoutException($"{name} health check at {url} did not succeed within {timeout}.");
    }

    private static void Kill(Process? p)
    {
        if (p is null || p.HasExited) return;
        try { p.Kill(entireProcessTree: true); } catch { /* best effort */ }
    }

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "Verdict.sln")) ||
                File.Exists(Path.Combine(dir.FullName, "Verdict.slnx")))
                return dir.FullName;
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException("Could not locate repo root (Verdict.sln / Verdict.slnx not found).");
    }
}
