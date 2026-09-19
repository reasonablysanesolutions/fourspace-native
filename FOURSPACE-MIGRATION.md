# Four Space Native — Migration Plan

This document records how **Four Space Native** is derived from two existing
systems, and the decisions made along the way. It reflects the actual
implementation, not aspirational design.

- **Four Space Electron** = `/Volumes/Mr_Jones/Projekt/appar-macos/Fourspaces`
  (a fork of T3 Code with the Four Spaces product layer). **Read only.**
- **T3** = `https://github.com/pingdotgg/t3code` (the upstream AI harness).
  **Read only.**
- **Four Space Native** = this repository
  (`reasonablysanesolutions/fourspace-native`), a fork of T3 that carries the
  native macOS app.

The guiding principle:

> Four Space Electron defines **what the product is**.
> T3 defines **what the AI harness can do**.
> Four Space Native combines the two as a first-class macOS app.

## 1. Git / upstream strategy

| Remote | URL | Role |
| --- | --- | --- |
| `origin` | `https://github.com/reasonablysanesolutions/fourspace-native.git` | Our fork. Push here. |
| `upstream` | `https://github.com/pingdotgg/t3code.git` | T3 original. **Never push.** |

- The fork was created with the GitHub fork API so the parent relationship to
  `pingdotgg/t3code` is real.
- Local history was cloned from the Four Spaces Electron fork so the product
  layer commits (`feat(spaces): ...`) are preserved as reference.
- Development happens on the **`native`** branch.
- `origin/native` is the integration branch. `upstream/main` is consumed only
  deliberately; there is no automatic merge.

**The two original checkouts must never change.** A baseline was recorded
before any work:

- `Fourspaces` HEAD `1d2ae7fb7` with pre-existing uncommitted working-tree
  changes. These were present before this work and are left untouched.
- `pingdotgg/t3code` is only ever fetched, never modified.

## 2. What Four Space Electron actually is

Despite the name, "Four Space Electron" is a T3 Code fork: the Electron
desktop app wrapping `apps/web`, plus a "Four Spaces" layer added across
web + server + client-runtime. It is the product/UX facit.

### 2.1 Concepts

- **Four Spaces** are a UI/organisational dimension over T3 workspaces:
  `chat`, `experiment`, `project`, `product`.
- A **Project** is, first and foremost, **a normal folder on disk**. Four
  Spaces never hides projects in a proprietary database. A folder for
  `/Volumes/Mr_Jones/Projekt/SlimJim` stays openable by any other harness.
- **Product** is a long-lived thing that can contain or link several Projects
  and Experiments.
- **Scheduled** is a global function (agents, recurring tasks, automations),
  not a fifth space.

### 2.2 Four Spaces data model (client-side, `packages/client-runtime/src/fourspaces/registry.ts`)

- `FourSpaceKind = experiment | project | product`.
- `FourSpaceWorkspaceEntry { workspaceId, workspaceRoot, projectId?, kind, originProductId? }`.
- `FourSpacesEnvironmentState { version, defaultRoot, defaultImportMode, chatProjectId, entries }`,
  persisted per environment under `t3code:fourspaces-registry:v1`.
- `DEFAULT_FOURSPACES_ROOT = /Volumes/Mr_Jones/T3`, chat backing at
  `<root>/Chat`.
- Visibility rule: Chat shows only its backing project; a kind space shows
  classified projects of that kind **plus unclassified projects**, so
  organising never hides work.
- Classification is a **side system** — it never adds fields to T3's
  `OrchestrationProject` or `project.create`.

### 2.3 Feature inventory (verified in Electron)

Navigation / shell
- Permanent rail: Four Spaces (Chat, Experiment, Project, Product) + Scheduled
  + Settings, with discrete themed accents; pinned usage bar before the
  settings divider. Rail width `13rem`.
- Three-pane shell: rail → thread list → chat.

Create / import
- `NewWorkspaceDialog`: kind picker + name, destination preview, duplicate-root
  refusal, optional product-context snapshot.
- `ImportWorkspaceDialog` with two tabs:
  - *Import folder*: keep / move / copy, kind, destination folder name,
    machine picker, native or server folder browse.
  - *From T3*: classify existing unclassified T3 workspaces (organise),
    optional move to standard root.
- Classification is applied first; moving is a separate, optional step.

Projects
- `project.create` at destination + registry entry. Existing folders are
  imported without conversion; never moved without explicit request.
- `fourspaces.relocateWorkspace` does move/copy (rename, with copy+delete
  fallback across volumes, EXDEV-safe).
- Promote Experiment/Project → Product is a type change, folder untouched.

Notes & context
- `NotesDialog` edits `NOTES.md` (autosave ~1.5 s, read-once, last-writer-wins).
- `PRODUCT_CONTEXT.md` is written (best effort) when a new Experiment is
  created from a Product; sources are `README.md`, `AGENTS.md`, `NOTES.md`,
  `product-memory.md`, truncated.
- `ProductDialog`: overview, related experiments, New Experiment, Notes.

Scheduled
- Jobs with `once | daily | weekly | interval` schedules + IANA timezone.
- A tick loop (30 s) executes jobs as **real T3 turns** (thread.create if
  needed + thread.turn.start), with claim-before-execute and a running sweep.
- UI: Upcoming / Recurring / History, Run now, Pause/Resume, Edit, Delete.

Usage
- Global usage bar (pooled provider limits % left + reset; Today spend + cache
  %; OpenRouter today) plus OpenRouter analytics (today/7d/30d, top models,
  USD) and key management.

Settings
- `/settings/four-spaces`: per-machine standard root, default import mode,
  OpenRouter key + usage.

Persistence
- Registry: browser `localStorage` per environment.
- Scheduled jobs/runs: SQLite side tables (`fourspaces_scheduled_jobs`,
  `fourspaces_scheduled_runs`).
- OpenRouter key: server secret store (`fourspaces.openrouter_api_key`).
- Project files: `NOTES.md`, `PRODUCT_CONTEXT.md` on disk.

Server RPC added
- `fourspaces.relocateWorkspace`, `fourspaces.getOpenRouterUsage`,
  `fourspaces.setOpenRouterKey`, `fourspaces.clearOpenRouterKey`;
  `scheduled.{listJobs,createJob,updateJob,deleteJob,runJobNow,listRuns}`.

## 3. What T3 is

T3 is an event-sourced Node/WebSocket server wrapping provider CLIs and
agents, serving web / desktop / mobile clients.

- **Clients** send typed WebSocket requests.
- The server turns them into **commands**; a pure **decider** turns commands
  into persisted **events**; a **projector** derives the read model.
- **Provider CLIs** run as subprocesses; per-provider **adapters** translate
  their protocols into orchestration events.
- **Reactors** run side effects in queues and emit **receipts**.
- Each turn ends with a **checkpoint** (a hidden git ref) for diff/restore.

Key surfaces:

- Transport: WebSocket `/ws`; HTTP `/api`, `/oauth`, `/.well-known`; single
  origin in dev (Vite proxies).
- Orchestration RPC (`packages/contracts/src/orchestration.ts`):
  `orchestration.dispatchCommand`, `subscribeShell`, `subscribeThread`,
  `getTurnDiff`, `getFullThreadDiff`, `searchThreads`, `getWorkflowScript`,
  `getArchivedShellSnapshot`. 29 event types; shell snapshot + stream.
- Providers: Codex, Claude, Cursor, Grok, OpenCode, Antigravity adapters.
  Model lists, streaming, reasoning options, tool calls, cancellation, retries
  all live at the adapter boundary.
- Data: `<T3-home>/userdata/state.sqlite` (event-sourced + projections +
  migrations). Dev uses `<worktree>/.t3`.
- Settings/secrets: `ServerSettings`/`ClientSettings` contracts; secrets in a
  `ServerSecretStore`.
- Usage: transcript scanning + LiteLLM pricing + overrides; OpenRouter not a
  first-class provider upstream (the Four Spaces fork added read-only
  analytics via the OpenRouter API).
- Tools/runtime: terminal (libghostty reference under `native/`), filesystem,
  Git, browser, computer use, MCP, permissions.
- `native/` at the T3 repo root contains vendored **read-only reference**
  projects (`browser-secret`, `hyprland-snap-shot`, `kde-snap-shot`,
  `libghostty-vt`, `resource-monitor`). It is not a place to add our app.

## 4. Capability mapping

Decision keys:
**A** reuse logic · **B** port to Swift · **C** replace with native impl ·
**D** keep as separate service · **E** not needed.

| Capability | Decision | Notes |
| --- | --- | --- |
| Provider adapters, streaming, tool calls, retries, cancellation | **D** | Too large to reimplement; T3 server owns this. Native client consumes typed events. |
| Sessions / threads / turns / event sourcing / checkpoints | **D** | Server is the source of truth. |
| Orchestration WS protocol | **A/D** | Reuse the contract as-is; generate/translate to Swift types. |
| Persistence of projects/threads (SQLite) | **D** | Server owns it. |
| Scheduled job engine | **A/D** | Reuse server RPC. The native app renders and drives it. |
| OpenRouter analytics | **A/D** | Reuse server RPC; render natively. |
| Usage / cost tracking | **D/C** | Server gathers; native renders. Add native Keychain for keys. |
| Four Spaces classification/registry | **B/C** | Port pure logic to Swift; persist natively. |
| Project on disk = plain folder | **C** | Native file APIs; no proprietary DB. |
| New / Import / Organize / Move / Copy flows | **B/C** | Native sheets + `FileManager`; call `fourspaces.relocateWorkspace` for cross-volume safety. |
| Notes (`NOTES.md`) | **C/B** | Native text editing + debounced autosave. |
| Product context snapshot | **B** | Port the pure builder; write read-only markdown. |
| Permissions | **C** | Native, human-readable permission model; enforce at the tool boundary. |
| API keys / secrets | **C** | macOS Keychain (with optional bridge to server secret store). |
| Terminal | **D** | Server executes; native renders output (later: libghostty). |
| MCP / plugins | **D** | Server-side. |
| Browser / computer use | **D/C** | Server tools; native gating + preview UI. |
| Model selection | **A/C** | Server model lists; native picker. Per-space defaults stored natively. |
| Web/Electron/Chromium UI | **E** | Not wanted. |

### Architectural decision: reuse the T3 server as the harness engine

The native app **does not reimplement** providers, streaming, tools, sessions
or persistence in Swift. It launches and talks to a T3 server process
(`npx t3` / bundled runner) over the typed WebSocket API — the **separate
service** option. This preserves the full harness capability and keeps a
small, honest native surface:

```
FourspaceNative.app  (SwiftUI, AppKit, Keychain, FileManager)
        │  typed WebSocket (orchestration + fourspaces + scheduled RPC)
        ▼
T3 server (Node)  ──►  provider adapters  ──►  Codex / Claude / OpenRouter / …
        │
        └─ state.sqlite, checkpoints, tools, terminal, Git, MCP
```

Four Spaces structure/UX lives natively; T3 supplies harness power. This is
the intended split, not a temporary scaffold.

## 5. Provider strategy

- Provider-agnostic. Target set: OpenRouter, OpenAI, Anthropic, Google,
  DeepSeek, local models, and generic OpenAI-compatible endpoints.
- Per-surface model selection: Chat, Experiment, Project, Agent, Scheduled.
  Products get a default that underlying projects/experiments may override.
- API keys in macOS Keychain. OpenRouter is first-class in the UI: current
  model/provider, context size, input/output/cached tokens, cache hits/misses
  where available, and costs (session, today, project, total) in SEK.
- A discreet but always-reachable usage indicator.

## 6. Persistence strategy

Two strictly separated layers:

**Four Space internal data** (native app):
- chats, UI state, session metadata, usage view cache, agent definitions,
  schedules, project references, space classification, per-space model
  defaults.

**User project data** (normal files on disk):
- The project folder itself. Four Space metadata is minimal, documented,
  non-destructive, easy to ignore and recreate, in open formats
  (`.t3space.json`, Markdown).

A project folder must remain openable by Codex, Hermes, OpenCode, Cursor,
VS Code or a terminal without export or conversion.

## 7. Context strategy

Never send the whole project every request. Prefer stable prompt prefixes,
selective context, caching, summaries and retrieval over full-context brute
force. Sources: current conversation, explicitly selected files, relevant
project files, project instructions (`AGENTS.md` / `PROJECTS.md`), tool
output, search results, earlier summaries. The user should be able to see
roughly **what** is sent and **why**.

## 8. Tool strategy

Modular tools: read/write/search files, run commands, Git, browser, computer
use, web, MCP, external tools, agents. Agents attach to Projects and
Scheduled jobs. Tools are gated by permissions.

## 9. Permission strategy

Agents never get unrestricted machine access by default. Human-readable
permissions: read project, write project, run commands, Git, network,
browser, computer control, external folders, external apps.

## 10. Design language

Derived from Four Space Electron, but expressed as a real Mac app.

- Clean, calm, obvious, physical, premium, minimal, easy to orient in.
- The work dominates the screen. No dashboard chaos.
- Discrete identity accents: Chat royal blue, Experiment velvet violet,
  Project velvet green, Product a warm sophisticated accent.
- Colour aids orientation; it does not fill the screen.
- No neon, no cyberpunk, no heavy glassmorphism, no generic AI gradients,
  no decorative imagery, not a sea of cards.
- Prefer native macOS components when they are better.

## 11. Native architecture (target)

```
App        UI        Domain
AI         Providers Sessions Chats
Experiments Projects  Products
Agents     Tools      Files  Git
Browser    Scheduling Usage
Persistence Security
```

Protocols between subsystems. No giant Swift files, no giant view models, no
hard UI↔provider coupling, no singleton sprawl, no spaghetti state.

## 12. Risks

1. **Two-process lifecycle.** Bundling/launching a Node server from a native
   app adds install, port, auth and update complexity. Mitigation: treat the
   server as a managed child process with health checks; support attaching to
   an already-running server.
2. **Protocol drift.** T3's contract changes upstream. Mitigation: keep a
   translation layer and pin the server version we ship against.
3. **Contract size.** The orchestration contract is large; porting only what
   each phase needs avoids a big-bang type dump.
4. **Duplicated domain logic.** Four Spaces classification exists in JS and
   will exist in Swift. Mitigation: keep it a thin side system with pure
   functions and tests on both sides.
5. **Keychain vs server secret store.** Two secret stores could diverge.
   Mitigation: native Keychain is the source; push to the server only when
   the server needs a key to run a turn.
6. **Actively in-use original.** The Electron checkout is live and its working
   tree changes. Mitigation: never write to it; clone committed history only.

## 13. Migration phases

- **Phase 0** Discovery. *(done)*
- **Phase 1** Create Four Space Native fork/clone. *(done)*
- **Phase 2** Minimal native macOS app that builds and launches. *(done)*
- **Phase 3** Reproduce the Four Space shell and navigation natively.
  *(in progress)*
- **Phase 4** Chat end-to-end with a real model.
- **Phase 5** Providers and model selection.
- **Phase 6** Sessions and persistence.
- **Phase 7** Projects + existing folders.
- **Phase 8** Files + Git + terminal/tools.
- **Phase 9** Experiments.
- **Phase 10** Products.
- **Phase 11** Agents.
- **Phase 12** Browser / computer use / MCP / tools.
- **Phase 13** Scheduled.
- **Phase 14** Usage / OpenRouter costs / context transparency.
- **Phase 15** Settings / Keychain / permissions.
- **Phase 16** Native polish, accessibility, keyboard navigation, performance.

Work is **vertical** and incremental. The app stays runnable throughout. After
each meaningful change: build, fix, launch, verify, commit.

## 14. Open questions

- Bundle the T3 server runtime inside the app, or require an existing
  `npx t3`/desktop-hosted server on first run? (Leaning: managed child process
  with attach fallback.)
- How much of the Four Spaces classification is mirrored to
  `.t3space.json` on disk versus kept only in the native store?
- Whether to generate Swift types from `packages/contracts` or hand-write the
  subset per phase. (Leaning: hand-write per phase, generate later.)
