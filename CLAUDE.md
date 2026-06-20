# Verdict — Claude instructions

Always explain every `az` CLI command you give me — what it does, what each flag means, and whether it's destructive.

Ask me questions before writing code if anything is ambiguous.

## Project overview
Browser multiplayer party game "Verdict" — hot takes on trial.
- Backend: C# .NET 10 isolated worker, Azure Functions v4, Consumption plan
- Storage: Azure Table Storage (`Azure.Data.Tables`)
- Frontend: vanilla HTML+JS in `/docs`, served via GitHub Pages
- Identity: GUID in URL hash, no auth
- Infra: Bicep (`infra/main.bicep`), deployed via GitHub Actions with OIDC
- Local dev: Azurite (storage emulator) + Azure Functions Core Tools
- Tests: Playwright E2E in `tests/e2e/` (agent-run)

## Key files
- `src/Verdict.Functions/Domain/GameService.cs` — all game logic, retry loop
- `src/Verdict.Functions/Domain/SideAssigner.cs` — deterministic side assignment
- `src/Verdict.Functions/Functions/GetState.cs` — security-critical: phase-aware redaction
- `docs/app.js` — frontend polling loop, rendering, GUID-in-hash identity
- `infra/main.bicep` — all Azure resources declared as code

## Local dev setup
1. Install Azurite: `npm install -g azurite` then run `azurite`
2. Install Azure Functions Core Tools v4
3. `cd src/Verdict.Functions && func start`
4. Frontend: serve `/docs` with any static server (e.g. `npx http-server docs -p 8080`)
