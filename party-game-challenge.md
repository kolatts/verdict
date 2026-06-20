# 🎮 Coding Challenge: Build a Party Game

*Because "Todo App #47" isn't going on your portfolio.*

💰 **Estimated Monthly Hosting Cost:** ~$0–2 (Azure free tier is embarrassingly generous)
⏱️ **Estimated Time:** One weekend — 8–12 hours if you actually focus
📊 **Difficulty:** Junior–Mid (you've touched a cloud function before, even once)

---

## What You're Building

A **browser-based multiplayer party game** for 3–8 players in the same room. The formula is simple:

1. **Join** — one person creates a room, shares a code, others join
2. **Play** — something happens, players submit something, state evolves
3. **Reveal** — everyone sees the result at the same time

What happens in the middle is your creative problem. Pick one of the formats below or invent your own — as long as it fits the formula, you're in scope.

---

## Game Formats — Pick One (or Bring Your Own)

These are starting points, not instructions. The rules, scoring, and win conditions are yours to design.

| # | Format | The Mechanic | The Reveal |
|---|--------|-------------|------------|
| 1 | **Social Deduction** | One player has hidden information the others don't | Vote on who's hiding something — then expose the truth |
| 2 | **Prompt Battle** | Everyone answers the same absurd prompt anonymously | Group votes on the funniest / best answer, Jackbox-style |
| 3 | **Prediction Market** | Players bet on how the group will answer a question | Tally who read the room best |
| 4 | **Collaborative Story** | Each player adds a sentence without seeing the full story | Read the whole disaster aloud at the end |
| 5 | **Trivia Showdown** | Players buzz in or race to answer questions | Leaderboard flips live as answers lock in |
| 6 | **Ranking Clash** | Everyone ranks the same list independently | Reveal how differently (or identically) everyone thinks |
| 7 | **Auction / Bidding** | Players bid fake currency on outcomes or items | Winner takes all — loser explains themselves |

---

## What You're Learning

By the end of this you'll have actually used — not just nodded at in a tutorial:

- **Azure Functions v4** on the Consumption plan — HTTP triggers, cold starts, the stateless life
- **Azure Table Storage** — lightweight, schemaless state that is not a real database, which is the point
- **GUID-based identity** — no auth, no accounts, just a URL that proves you exist
- **Polling-based state sync** — because WebSockets cost money and this is a free tier challenge
- **GitHub Pages** — zero-config static hosting from your `/docs` folder

---

## Before You Write Code — Ask Claude to Set You Up

You don't need to know any of this ahead of time. You need to know how to ask.

Open a fresh Claude conversation and paste this:

> *"I'm setting up for an Azure Functions project. I need to: create a free Azure account, set a $5/month cost alert, install the Azure CLI and Azure Functions Core Tools, create a GitHub repo with GitHub Pages enabled from the `/docs` folder. Walk me through each step one at a time. Explain every `az` CLI command before I run it — what it does, what each flag means, and whether it's destructive."*

Don't rush this part. A broken environment at 11pm Saturday is how weekends die.

Once your repo exists, drop a `CLAUDE.md` in the root:

```
Always explain every az CLI command you give me — what it does,
what each flag means, and whether it's destructive.
Ask me questions before writing code if anything is ambiguous.
```

Every Claude session you start in this repo inherits these rules. Future you will be grateful.

---

## Pick Your Language

Azure Functions v4 supports all of these. Pick what you'd reach for on a normal day — this challenge is about game logic and cloud plumbing, not learning a new language simultaneously.

| Language | Runtime | Notes |
|----------|---------|-------|
| C# (.NET 10 isolated worker) | .NET 10 | Isolated worker model only — in-process retires Nov 2026 |
| Node.js JavaScript | Node 22 | Node 20 support ended April 2026 — don't use it |
| Node.js TypeScript | Node 22 | Transpiles to JS — same runtime |
| Python | Python 3.13 | Recommended for new deployments as of 2026 |

---

## Architecture

Your game will need roughly these Azure Functions. Name them whatever makes sense for your game:

| Function | Job |
|----------|-----|
| `create-room` | Generates a room code, writes initial state to Table Storage, returns host GUID |
| `join-room` | Adds a player to an existing room, returns their GUID |
| `get-state` | Returns current game state — polled by the frontend every 2–3 seconds |
| `submit-action` | Handles any player input: answer, vote, bid, buzz — your game decides what |
| `advance-phase` | Moves the game forward: lobby → play → reveal |

**The design problem that will make or break your weekend:** concurrent writes. Table Storage has no transaction lock and no event stream — just a row that multiple players read and write at the same time. Figure out your approach *before* you write your first function.

Ask Claude: *"How do I handle concurrent writes to a single Azure Table Storage row without corrupting state? What's optimistic concurrency and when do I need it?"*

---

## Screens

Three states. That's it.

1. **Lobby** — Players join via shared code, host sees everyone, host starts the game
2. **Play** — The actual game. One phase or several — your call
3. **Reveal** — Results, scores, winners, the moment everyone either cheers or argues

Everything else is scope creep. You know who you are.

---

## Stack Constraints (Non-Negotiable)

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla HTML + JavaScript, GitHub Pages (`/docs`) |
| Backend | Azure Functions v4, your language of choice |
| Storage | Azure Table Storage |
| Identity | GUID in URL — no login, no auth, no accounts |

One resource group. One storage account. No paid tiers. If you're spinning up anything else, you've overcomplicated it.

**Supported runtimes:** C# (.NET 10 isolated worker), Node.js 22 (JS or TS), Python 3.13. The in-process C# model retires November 2026 — don't start a new project on it.

---

## Done When

Three real humans can do all of this without you explaining anything:

- [ ] One person creates a room, shares the code, two others join from separate browser tabs
- [ ] The game plays through a full round with all players participating
- [ ] Everyone sees the reveal at the same time at the end

---

## Stretch Goals

*After done. Not instead of done.*

- Per-phase countdown timer
- Spectator mode — watch without a GUID
- Round history visible on the result screen
- Multiple rounds with cumulative scoring

---

## Estimated Monthly Hosting Cost

| Service | Cost |
|---------|------|
| Azure Functions (Consumption) | $0 — first 1M executions/month free, forever |
| Azure Table Storage | $0 — first 1GB free for 12 months |
| GitHub Pages | $0 |
| **Total** | **~$0–2/month** after free tier |

If this costs you more than $2/month, you have 47 people playing simultaneously. Congratulations, you have a different problem now.
