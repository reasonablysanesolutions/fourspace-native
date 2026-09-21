# Project Memory

This file is the shared memory for **Four Space Native**, the native macOS app
in this repository. The Electron product's history is preserved at the bottom
under "Appendix: Four Spaces Electron memory".

## Four Space Native — current state

- Repo: fork `reasonablysanesolutions/fourspace-native` of `pingdotgg/t3code`.
  `origin` = fork, `upstream` = T3 original (never push). Branch: `native`.
- Real fork created via GitHub API; local history cloned from the Fourspaces
  Electron fork so product-layer commits are preserved.
- Native app at `macos/` (SwiftPM, `swift-tools-version: 6.0`, macOS 15+).
  Builds and launches. Three-column SwiftUI shell: rail (Chat/Experiment/
  Project/Product + Scheduled + Settings), content column, detail column.
- Phase 4 done: live Chat. `T3RpcClient` (actor) speaks Effect RPC JSON over
  WebSocket (`Request`/`Ack`/`Chunk`/`Exit`), auth via `Authorization: Bearer`
  on the `/ws` upgrade, token in Keychain. `T3Connection` builds
  `project.create`/`thread.create`/`thread.turn.start` and streams
  `orchestration.subscribeThread`. Verified end-to-end with Codex via
  `--probe` (streamed `fourspace-probe-ok`).
- Build: `macos/scripts/build-app.sh`, run `open macos/.build/FourspaceNative.app`.
  Headless: `FOURSPACE_URL=… FOURSPACE_TOKEN=… macos/.build/debug/FourspaceNative --probe`.
- Docs: `FOURSPACE-MIGRATION.md` (plan, capability map, decisions),
  `ARCHITECTURE.md` (actual implementation).
- Originals are read-only and untouched: Electron at
  `/Volumes/Mr_Jones/Projekt/appar-macos/Fourspaces` (HEAD `0459d531f`, has
  pre-existing uncommitted changes — do not touch), and `pingdotgg/t3code`.

## Key decisions

- Reuse the T3 server as the harness engine (separate service over typed
  WebSocket). Do not reimplement providers/sessions/tools in Swift.
- Four Spaces classification and structure are native; a Project is a plain
  folder on disk. No lock-in.
- Native app lives in `macos/`; repo-root `native/` is T3's vendored
  read-only references, leave alone.
- Dynamic `JSONValue` for the wire; typed models per phase where useful.
- `@main` on a small `Entry` so the same client runs headless (`--probe`).

## Known issues

- Keychain prompt on dev builds when a credential was seeded by another
  process (ad-hoc signature). Normal use (app writes its own item) does not
  prompt.
- Chat uses runtime mode `full-access` (no approval UI yet).
- No session list / thread sidebar yet; Chat reuses its most recent thread.

## Next steps

1. Phase 5/6: provider + model selection polish, sessions/threads list and
   persistence of per-space model defaults.
2. Approvals / user-input handling for non-full-access modes.
3. Phase 7: Projects + importing existing folders.


---

# Appendix: Four Spaces Electron memory (read-only reference)

## Current state

- Personlig fork: `https://github.com/reasonablysanesolutions/t3code`, vårt arbete på branchen **`fourspaces`** (= lokal main `45451e1e9`, 10 egna commits). Forkens `main` är orörd upstream (medvetet: vanlig `main`-push avvisades pga divergerad historik, ingen force-push, ingen blind merge av 2 månaders upstream).
- Remotes: `origin` = upstream (pingdotgg, rör aldrig med push), `fork` = egen fork.
- FAS 2–11 klara och committade lokalt + pushade. Arbetsträd rent (enda untracked: `design.fourspaces-reference.png`).
- Acceptance §68 genomgången 2026-09-19: navigation, new, import (keep/move/copy + organize), portabilitet, modeller, notes, product-workflow, promote, usage, scheduled — allt verifierat (se nedan). Kvarvarande luckor: live OpenRouter-nyckel, daily-tick över dygn, explicita Project-kind-klick (samma kodvägar som verifierade kinds).

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

- HOTFIX (2026-09-19, `295cff4ff`, pushad): Chat-backing pekade på borttagen `~/T3/Chat` (egen smoke-städning som tog katalogen men lämnade projektet) → missing-folder-banner i Chat. Liket raderat via `project remove` (korrekt event, ej SQL). Guard tillagd: landing probar backing-rooten, vid klart saknad mapp droppas länken + roten exkluderas sessionsvis → nyskapande/adoption av levande projekt. Transienta fel länkar aldrig ur. Lärdom: städa aldrig en katalog som ett T3-projekt pekar på utan att ta bort projektet också.
- ACCEPTANCE §68 (2026-09-19) + FORK-PUSH. Allt grönt utom dokumenterade luckor:
  - Promote Project→Product type-only (mapp orörd, kind=product) + jobb-edit (titel+prompt) via UI, 0 pageerrors.
  - Portabilitet (§19-testet): `codex exec --cd /tmp/fs-accept/portable --sandbox read-only` läste NOTES.md och svarade — ingen export/konvertering, filen orörd.
  - Tick end-to-end: once-jobb avfyrades på schema utan manuell hjälp; agenten svarade "tick-ok"; run completed på ~7s; jobbet inaktiverades (once-semantik). Acceptans-jobben bortstädade ur DB efteråt.
  - Push: `git push fork main:fourspaces` (ingen force, ingen merge). Commit `45451e1e9` bekräftad på GitHub.
- FAS 11 klar (2026-09-18): Scheduled — jobb som kör riktiga T3-turns.
  - Kontrakt: schedule (once/daily/weekly/interval + tz), jobb, runs, CRUD-inputs, list-wrappers.
  - Server: migration 054 (jobs+runs-tabeller), `ScheduledJobs`-tjänst (CRUD, tick var 30s via forkParked, claim-före-execute, sweep av running via latestTurn + 2h-timeout, once inaktiveras efter körning), exekvering via engine.dispatch (thread.create vid behov + thread.turn.start — vanliga turns med checkpoints/streaming), layer i ReactorLayerLive + 6 RPC:er + server.test.ts-mock.
  - Ren schedule-matte (Intl-tz, UTC-iteration) + validering, 5 tester. Klient-atoms. UI: Upcoming/Recurring/History, jobb-dialog (titel, workspace, prompt, provider/modell från server-listan, schedule-kontroller), Run now/Pause/Resume/Edit/Delete(confirm), history med duration + Open thread, 10s-poll medan runs är aktiva.
  - Fällor (dyra): `Schema.Struct({})`-success kräver `{}`; osynkade maps→any-kaskad; Effect-functioner MÅSTE anropas (`tick()` inte `tick`); `randomUUIDv4` har E=PlatformError (mappa!); `new Date()` förbjudet även i pura funktioner (ms direkt till Intl); service-tagg måste matcha filsökväg (`t3/fourspaces/scheduledJobs`); server.test.ts-bygget behöver mock för nya tjänster; `useScopedSettings` kräver SettingsScopeProvider (ej på /scheduled — använd rå provider-lista); ProjectId/ThreadId bor i baseSchemas (ej orchestration); relativ import från fourspaces/ är `../`.
  - Verifierat: migration appliceras, CRUD/paus/edit/delete via UI, Run now → riktig Codex-turn completed, history + open-thread, 0 pageerrors. tsc/lint/knip rena, 5+3 tester.
- FAS 10 klar (2026-09-18): global usage-bar + OpenRouter analytics.
  - UsageBar i rail-botten (alla vyer): Codex-pool % kvar + reset (samma pooled snapshots som Limits), Today $ + Cache % (samma summary-query som usage-sidan), OR $ idag. Klick → /usage. Estimat tydligt märkta; OR i USD.
  - OpenRouter: kontrakt (status/windows/modeller, USD), server-tjänst (`/auth/key`+`/credits`+`/activity`, defensiv parsing, 5-min cache, nyckel i ServerSecretStore `fourspaces.openrouter_api_key`), 3 RPC:er (get=read, set/clear=operate), klient-atoms, settings-sektion (status, nyckelhantering, today/7d/30d, toppmodeller).
  - Fällor (dyra lärdomar): tomma `Schema.Struct({})`-success kräver `{}`-retur (void ger TS2322→any-kaskad i bin/cli); osynkade RPC/auth/handler-maps ger TS7053→samma kaskad; Effect `yield* fn` utan anrop, `Date.now/new Date` förbjudet i Effect (Clock/DateTime, `makeUnsafe` i v4); python-str.replace ersätter ALLA förekomster (ws-duplikation — använd Edit-verktyget).
  - Verifierat: bar-render med riktiga siffror, bogus-nyckel→fel+Remove→rensad (secret-fil borta), 0 pageerrors. tsc/lint/knip rena, 3+3 tester.
- FAS 9 klar (2026-09-18): Promote — kind-byte + valfri flytt i From T3-fliken.
  - Delat: `selectOrganizedWorkspaces` (+test): klassificerade rader sorterade på root, även utan live-projekt.
  - Web: OrganizePanel fick Organized-sektion (checkbox + kind-radio + Move-toggle med destinationspreview; single Apply med job-snapshot före första await; fel samlas, framgång applyas radvis). Uns­orted-sektion oförändrad i beteende.
  - Klassificering först, flytt separat: type-only ändrar bara raden; move kör relocate RPC + `project.meta.update` (identitet/trådar/historik bevaras).
  - Fällor: osorterade är förvalda — smokes måste avmarkera ("Select none") annars klassificeras hela dev-katalogen (hände, ofarligt); toast har role=dialog (skopa selektorer); 1 ny compiler-warning av redan vanlig klass (Sidebar har 27).
  - Verifierat: type-only (kind product, mapp+DB-root orörda), move (källa borta, dest med marker, DB-root följer, samma project-id), 0 pageerrors. tsc rena, 25 tester, lint 0 errors. Fixturer städade.
- FAS 8 klar (2026-09-18): Product → New Experiment + relation + PRODUCT_CONTEXT.
  - Delat: `fourspaces/product-context.ts` (+tester): snapshot-byggare (README/AGENTS/NOTES/product-memory, trunkering, null vid tomt), related-lista. Registry: `resolveOriginProductTitle` + `resolveOriginProductRef` (+tester).
  - Web: `ProductDialog.tsx` (översikt: titel/root/counts, relaterade experiment med open, New Experiment, Notes), New-dialog med From-linje + snapshot-skrivning (best effort, blockerar aldrig), ui-store mode + host, ChatHeader: produktknapp (Package) + From-chips.
  - Fällor: tomma drafts remappas mellan projekt (samma URL ≠ samma projekt — verifiera via breadcrumb); relaterade utan trådar faller tillbaka på landing.
  - Verifierat: import→overview→new→context-fil på disk (innehåll), From-chips i header, relaterad-lista + open, 0 pageerrors. tsc/lint/knip rena, 24+ tester.
- FAS 7 klar (2026-09-18): Notes — lugn editor över NOTES.md, ingen composer-kirurgi.
  - Delat: `fourspaces/notes.ts` (+tester): filnamn, autosave-delay, missing-matcher, hasNotesFile (endast toppnivå).
  - Web: `useWorkspaceNotes.ts` (read-once, härledd text utan adopt-effekt, debounce-autosave, missing via matcher ELLER listEntries-verifiering, mount-refresh mot stale cache, last-writer-wins), `NotesDialog.tsx` (textarea + save-state + Copy, ingen preview v1), header-knapp i ChatHeader (dold i Chat), ui-store mode + host.
  - Skippat: composer-insert (agenten läser filen direkt), preview-toggle, Notes-flikar (med workspace-vyer).
  - Fällor: serverns read-fel saknar missing-signal — därför listEntries-verifiering; read-cachen måste refreshas vid open; missing-status viker för lastSaved efter save.
  - Verifierat: Edited→Saved-tid, persist över reopen, Chat utan knapp, 0 pageerrors. tsc/lint rena, 18 tester.
- FAS 6 klar (2026-09-18): visuellt skal — endast yta, ingen funktionalitet.
  - Rail: temamedvetna accentfärger per space (sky/violet/emerald/amber/slate med dark:-varianter, repo-konvention), neutral text, aktiv pill oförändrad.
  - Scheduled: mer luft (gap/py). Dialoger/settings redan lugna (verifierade visuellt).
  - Medvetet ORÖRT: T3:s composer, model picker, thread-sidebar, tema-system (default är redan system-följ med light-fallback — inget att ändra), Chat-chrome (ingen core-kirurgi för estetik).
  - Verifierat med skärmdumpar i light + dark: rail, scheduled, import-dialog. 0 pageerrors. tsc/lint rena.
- FAS 5 klar (2026-09-18): New-flöden + Four Spaces settings-sektion.
  - Registry: `defaultImportMode` (null=Keep) + sanitize/setter/test; modetypen bor i registry (relocate återexporterar alias).
  - Nytt: `NewWorkspaceDialog.tsx` (namn + kind + preview + dup-refusal, originProductId-plumbing för FAS 8), `workspaceKindPicker.tsx` (delad), `useOpenWorkspaceThread.ts` (delad finish; import refaktorerad).
  - Header: Plus-knapp "New Experiment/Project/Product" (dold i Chat); T3:s New project orörd.
  - Settings `/settings/four-spaces` (DEVICE_ONLY, egen nav-ikon): per-machine Standard root (input+Browse+reset) + Default import mode (förval i import-dialogen). Sökposter registrerade; övriga settings orörda.
  - Fälla: EnvironmentRow-children är shrink-0 auto-kolumn — nästlad SettingsRow overflowar; kompakt stacked layout krävs.
  - Verifierat: New (dir+projekt+rad+tråd+space), dup-refusal, settings-save→ny root används, import-preselect, 0 pageerrors.
- FAS 4 klar (2026-09-18): Import (Keep/Move/Copy) + Import from T3. Första backend-slicen: `fourspaces.relocateWorkspace`-RPC.
  - Kontrakt: `packages/contracts/src/fourspaces.ts` (mode/input/result/typade fel) + metod + Rpc + grupp. Server: `apps/server/src/fourspaces/relocateWorkspace.ts` (+3 tester): källa måste vara katalog, dest får ej finnas, aldrig in i sig själv; move = rename med copy+delete-fallback över volymgränser (upptäckt via smoke: /tmp→extern disk ger EXDEV); `~` expanderas som project creation. Handler i `ws.ts` (5 rader) + Operate-scope.
  - Klient: `fourspaces/relocate.ts` (rena namnregler + tester), `state/fourspaces.ts`-atoms (serial per env), web-wrapper.
  - Web: `ImportWorkspaceDialog.tsx` (Import folder: env, path + native picker/server-browse, kind, Keep/Move/Copy, folder-namn + preview; From T3: osorterade + kind per rad + batch), `FourspacesDialogs`-host, header-knapp (dold i Chat), auto-prompt en gång per env, import avslutas med space-byte + ny tråd.
  - Registrering återanvänder T3: Keep = findExisting/create + rad; Move med projekt = `project.meta.update` (identitet bevaras); övrigt create + rad.
  - Fällor: toast har också role=dialog (skopa selektorer!); pairing kräver redirect-väntan; addInitScript körs om vid reload; browser.close i finally; dev-only HMR-omevaluering kan nollställa session-dialog (prod opåverkat). LegacySidebar utan import-knapp.
  - Verifierat: alla tsc rena; 14+3 tester; lint/knip utan nya; smoke: Keep (checksummor+.git intakta), Move (innehåll+DB-root), Copy (identiskt, original kvar), organize-apply, auto-tråd ("What should we build in KeepMe?"), 0 pageerrors.
- FAS 3 klar (2026-09-18): Workspace Registry som klient-side sidosystem (noll server/kontrakt-ändringar).
  - Nytt: `packages/client-runtime/src/fourspaces/registry.ts` (+10 tester, export `./fourspaces/registry`): kinds experiment|project|product, entries {workspaceId, workspaceRoot, projectId?, kind, originProductId?}, defaultRoot (`~/T3`), chat-backing (`resolveChatProjectId`: lagrat id → exakt root → `T3/Chat`-tail vid default-root), `selectProjectsForSpace`/`selectVisibleProjects` (klassificerade endast i egen kind; oklassificerade synliga i kind-spaces så organisering aldrig döljer; Chat isolerad).
  - Nytt web: `fourspacesRegistryStore.ts` (zustand+persist `t3code:fourspaces-registry:v1`, per env), `useSpaceFilteredProjects.ts` (hook + `useSpaceVisibleProjectKeys` + `intersectProjectKeySets`), DEV-only `window.__fourspacesRegistryStore` för smokes.
  - Ändrat: `Sidebar.tsx` (filtrerad katalog + radfilter för trådar/drafts via intersect, scope bevaras; sökning ärver filtret), `LegacySidebar.tsx` (projektseam), `_chat.index.tsx` (space-scopad landing; Chat auto-skapar backing-projekt `<root>/Chat` via befintlig `project.create`, läker lagrat id), `__root.tsx` EventRouter (skippar bootstrap-nav i Chat), `FourspacesRail.tsx` (`flushSync` före navigate — annars startar landningen draft i förra spacets kontext), `spaces.ts` (kinds från registry).
  - Fällor: `~/` expanderas av servern till absolut root (tail-heuristik krävs för adoption); rail-navigering vs landing-race; Playwright `addInitScript`-seed måste vara komplett upfront (körs om vid varje reload).
  - Verifierat: 10/10 registry-tester, tsc (client-runtime+web) ren, lint 0 nya warnings, knip ren, headless-Chromium-smoke (Chat-autocreate på /Volumes/Mr_Jones/T3/Chat, filtrering per space, 0 pageerrors). Dev-state: Chat-projekt daced4ea aktiv; tom ~/T3/Chat-katalog bortstädad.
- FAS 2 klar (2026-09-18, `28dd554dc`): permanent Four Spaces-rail i webklienten.
  - Nytt: `apps/web/src/fourspaces/spaces.ts` (space-ids + pathname-resolution; spaces är UI-dimension, tråd-URL:er orörda), `apps/web/src/fourspaces/fourspacesNavStore.ts` (zustand+persist `t3code:fourspaces-nav:v1`), `apps/web/src/components/fourspaces/FourspacesRail.tsx` (Chat/Experiment/Project/Product — Scheduled — Settings), `apps/web/src/routes/scheduled.tsx` (Upcoming/Recurring/History empty states; auth-guard som `_chat`).
  - Ändrat: `AppSidebarLayout.tsx` (+12 rader: renderar rail; `--fourspaces-rail-width: 13rem`; fixed thread-sidebar + flytande toggle skiftas höger på md+ via `md:group-data-[state=expanded]:left-...`), `routeTree.gen.ts` (autogenererad, plockade upp `/scheduled`).
  - Viktig implementationsfälla: desktop-sidebar är `fixed left-0`-overlay med in-flow gap-spacer — rail i flow täcks utan left-offset. Verifierat expanded/collapsed/reopened via Playwright (Chromium headless): rail synlig på `/`, `/scheduled`, `/settings/general`; nav + persist (`activeWorkspaceSpace`) OK; 0 pageerrors; `tsc` ren; `vp lint` 0 errors (1 pre-existerande warning i orörd fullscreen-effekt).
- `git clone --depth 1 https://github.com/pingdotgg/t3code.git .` i `Fourspaces/` + `git fetch --unshallow` (full historik); `origin` = `pingdotgg/t3code`, ingen personlig fork-remote ännu.
- Skapade `/Volumes/Mr_Jones/T3/{Chat,Experiments,Projects,Products}/` (tomma standard-destinationer).

## Known issues

- Ingen personlig fork-remote konfigurerad ännu (`origin` = `pingdotgg/t3code`); inget pushat.
- `_chat.tsx` "new-thread-in"-palett räknar ofiltrerade projektgrupper (kosmetiskt; New-flöden i FAS 5 tar över skapande).
- Dev-state (`~/.t3/dev`) innehåller smoke-artefakter: Chat-projekt c99abe5e (pakar mot borttagen ~/T3/Chat) + daced4ea (aktiv, /Volumes/Mr_Jones/T3/Chat) + server-projekt. Ofarligt scratch; påverkar repo-kod inte.

## Next steps

1. Frivillig rest-verifiering: OpenRouter med riktig nyckel; daily-tick över dygn; explicita Project-kind-klick i New/Import (samma kodvägar).
2. Upstream-hygien: `git fetch origin`, merga `origin/main` → `fourspaces` vid behov (lös ev. konflikter i Sidebar/ws varsamt), pusha `fork fourspaces`. Pusha ALDRIG till `origin`. Sätt gärna `fourspaces` som default-branch på GitHub.
3. Dev-scratch i `~/.t3/dev` (testprojekt, trådar) är ofarligt men kan nollställas genom att ta bort katalogen om en ren demo behövs.
