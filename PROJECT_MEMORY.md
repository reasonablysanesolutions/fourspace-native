# Project Memory — Four Spaces (personlig T3-fork)

## Current state

- `Fourspaces/` är nu en shallow-fork (`--depth 1`) av `pingdotgg/t3code` (commit `9ea9c3d5`), inte längre tom.
- FAS 1-kartläggning klar (2026-09-18): navigation, projekt/tråd-modell, settings, modellväljare, usage, persistens.
- Inga T3-core-ändringar gjorda ännu. Enda untracked-filer: `design.fourspaces-reference.png`, denna fil.
- Standard-root skapad (tom): `/Volumes/Mr_Jones/T3/{Chat,Experiments,Projects,Products}/`.
- Verktygskedja KLAR: isolerad Node v24.21.0 i `~/.local/node-t3` (rör ej användarens hermes-node 26 eller `/usr/local/bin/node` 24.11.1), `pnpm 11.10.0` via corepack, `vp 0.3.3`, `bun 1.4.2` via vp-shim. `vp i` körd OK.
- `.env` med `T3CODE_DEV_AUTH_TOKEN` skapad (gitignored, mode 600).
- Ren T3-dev verifierad 2026-09-18: `vp run dev` → web `:5733` svarade 200, server `:13773` lyssnade, pairing-URL utskriven; enda WARN var Claude-CLI health check (Claude CLI ej installerad — benignt). Servern stoppad rent via egna PID:n (78725 → barn 78736/78738 verifierade via cwd+ppid före kill).
- Full git-historik hämtad (`git fetch --unshallow`); `origin` = `pingdotgg/t3code`, ingen personlig fork-remote ännu.

## Architecture (T3, verifierat lokalt)

- Klienter: `apps/web` (TanStack file-router, `routes/_chat.*`, `routes/settings.*`, `components/AppSidebarLayout.tsx`, `components/Sidebar.tsx` ~5k rader) — ingen left-rail finns; desktop wrappar web (Electron + hash-history), mobil är separat React Native (`apps/mobile/src/Stack.tsx`, `AdaptiveWorkspaceLayout`).
- Domän: `Project` = environment-lokal workspace-post rooted at directory (`OrchestrationProject{workspaceRoot}`); ett aktivt projekt per `workspaceRoot`. `Thread` hör till ett projekt (immutable `projectId`), `Turn` = en user→agent-cykel. Event-sourcad: `apps/server/src/orchestration/decider.ts` (ren) → `orchestration_events`-tabell → `projector.ts` → projektioner (`projection_projects/threads/...`). SQLite: `<T3-home>/userdata/state.sqlite` (`~/.t3` prod, `<worktree>/.t3` dev).
- Skapande: klient → `dispatchCommand(project.create{workspaceRoot})` via WS (`apps/server/src/ws.ts`); startup bootstrappas från cwd. Trådhistorik-import från Codex/Claude-transkript finns (`AgentSessionImporter.ts`).
- Settings: `packages/contracts/src/settings.ts` (`ServerSettings` + `ClientSettings`), `apps/server/src/serverSettings.ts` (JSON+Cache+PubSub), secrets i `ServerSecretStore` (redigerade). Sektioner katalogiserade i `components/settings/settingsSearch.ts`.
- Modellväljare: återanvändbar `components/chat/ProviderModelPicker.tsx`; modeller kommer dynamiskt från adapters (`apps/server/src/provider/Layers/*Adapter.ts`: Codex, Claude, Cursor, Grok, OpenCode, Antigravity). Reasoning = generiska `ModelSelection.options`.
- Usage: `apps/server/src/usage/UsageService.ts` skannar CLI-transkript (claude/codex/grok), priser via LiteLLM-tabell + overrides; kontrakt `packages/contracts/src/usage.ts`; UI `components/usage/UsagePage.tsx`. Ingen global bar idag (bara composer-banner). OpenRouter finns ej som förstklass-provider. Inget cron/scheduler finns (bara intervall-policies).

## Important decisions

- SMINK, INTE KIRURGI: Four Spaces = filter/nav/klassificering ovanpå T3 `Project`; aldrig parallella providers/trådar/streaming/terminal/git.
- Klassificering (`experiment|project|product`, `originProductId`) ska ligga i separat sido-system (ny SQLite-sidotabell `fourspaces_workspaces` eller `<stateDir>/fourspaces.json`), ALDRIG nya fält i `OrchestrationProject`/`project.create`/projektioner. Chat behöver ingen persistens (dold scratch-workspace).
- Upstream-diff minimal: nya routes/komponenter (`_fourspaces.*`, `FourspacesRail`), wrapper-komposition i `AppSidebarLayout`, delad logik i `packages/client-runtime`; `packages/contracts` ändras bara när data måste över WS-gränsen.
- Portabilitet: `.t3space.json`-sidecar får aldrig bli projektets hjärna; `NOTES.md`/`PRODUCT_CONTEXT.md` är vanliga filer i workspacen.
- `design.fourspaces-reference.png` ska aldrig committas (referensbild).

## Recent meaningful changes

- FAS 2 klar (2026-09-18, commit `feat(web): ...`): permanent Four Spaces-rail i webklienten.
  - Nytt: `apps/web/src/fourspaces/spaces.ts` (space-ids + pathname-resolution; spaces är UI-dimension, tråd-URL:er orörda), `apps/web/src/fourspaces/fourspacesNavStore.ts` (zustand+persist `t3code:fourspaces-nav:v1`), `apps/web/src/components/fourspaces/FourspacesRail.tsx` (Chat/Experiment/Project/Product — Scheduled — Settings), `apps/web/src/routes/scheduled.tsx` (Upcoming/Recurring/History empty states; auth-guard som `_chat`).
  - Ändrat: `AppSidebarLayout.tsx` (+12 rader: renderar rail; `--fourspaces-rail-width: 13rem`; fixed thread-sidebar + flytande toggle skiftas höger på md+ via `md:group-data-[state=expanded]:left-...`), `routeTree.gen.ts` (autogenererad, plockade upp `/scheduled`).
  - Viktig implementationsfälla: desktop-sidebar är `fixed left-0`-overlay med in-flow gap-spacer — rail i flow täcks utan left-offset. Verifierat expanded/collapsed/reopened via Playwright (Chromium headless): rail synlig på `/`, `/scheduled`, `/settings/general`; nav + persist (`activeWorkspaceSpace`) OK; 0 pageerrors; `tsc` ren; `vp lint` 0 errors (1 pre-existerande warning i orörd fullscreen-effekt).
- `git clone --depth 1 https://github.com/pingdotgg/t3code.git .` i `Fourspaces/` + `git fetch --unshallow` (full historik); `origin` = `pingdotgg/t3code`, ingen personlig fork-remote ännu.
- Skapade `/Volumes/Mr_Jones/T3/{Chat,Experiments,Projects,Products}/` (tomma standard-destinationer).

## Known issues

- Shallow clone: bara 1 commit lokalt. Kör `git fetch --unshallow` + sätt egen `origin` innan egen historik skrivs.
- Ingen `origin`/fork-remote konfigurerad ännu; inget committat.
- `vp`/`bun`/`pnpm` saknas; Node-version fel (26 vs krav 24). `vp i` + `vp run dev` ej verifierade.

## Next steps

1. Sätt personlig fork-remote (egen GitHub-fork) om upstream-pull ska vara smidig.
2. FAS 3: Workspace Registry som sidosystem (rekommendation från kartläggning: ny SQLite-sidotabell `fourspaces_workspaces` ELLER `<stateDir>/fourspaces.json` via JSON+Cache+PubSub-service; ALDRIG nya fält i `OrchestrationProject`) + sidebar-filtrering per space via `activeWorkspaceSpace`.
3. FAS 4: Import (Keep in place först) — registrera befintlig katalog som T3-project (`project.create`) + registry-rad; Move/Copy via filesystem-operation före registrering.
