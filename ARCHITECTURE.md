# Four Space Native — Architecture

Describes the **actual** native implementation as it exists. Update as the
app grows; do not record plans here (see `FOURSPACE-MIGRATION.md`).

## Status

Phase 7 complete: the HarnessStore is shared, Projects can create and import
plain folders, and project threads share the Chat conversation surface.

## Repository

- Fork `reasonablysanesolutions/fourspace-native` of `pingdotgg/t3code`.
- `origin` = our fork. `upstream` = T3 original (read only).
- Development branch: `native`.
- The T3 monorepo (JS) remains in the tree as the harness reference and
  future server runtime. The native app does **not** depend on it to build.

## Native app location

```
macos/
  Package.swift                     SwiftPM executable target
  Sources/FourspaceNative/
    App/
      Entry.swift                   @main; `--probe` headless path
      AppDelegate.swift             quit hooks; stops the owned server
      FourspaceNativeApp.swift      App scene, menu commands
      AppState.swift                @Observable top-level UI state
    Domain/
      FourSpace.swift               FourSpace, GlobalDestination, RailSelection
    Server/
      ServerController.swift        spawn/attach/stop the T3 server, mint token
    AI/
      JSONValue.swift               dynamic JSON for the wire protocol
      T3RpcClient.swift             Effect RPC over WebSocket (JSON envelopes)
      T3Connection.swift            typed facade + orchestration commands
      HarnessStore.swift            shared connection, providers, model, RPCs
    Chat/
      ConversationViewModel.swift   streams one thread's transcript
      ChatViewModel.swift           Chat space over the shared harness
    Projects/
      ProjectsViewModel.swift       project list, create/import, threads
    Security/
      Keychain.swift                generic-password Keychain wrapper
    Debug/
      Probe.swift                   headless round-trip (`--probe`)
    UI/
      RootView.swift                three-column shell
      RailView.swift                persistent left rail
      SpaceContentList.swift        middle column per destination
      SpaceDetail.swift             detail column
      ChatThreadList.swift          middle-column chat list
      ChatView.swift                live chat surface
      HarnessConnectView.swift      shared connect form
      ConversationPane.swift        shared MessageList + Composer
      ModelPicker.swift             shared provider/model picker
      ProjectsList.swift            project list + New Project sheet
      ProjectDetail.swift           project threads + conversation
  scripts/
    build-app.sh                    builds and bundles FourspaceNative.app
```

## Build & run

```bash
macos/scripts/build-app.sh          # debug
macos/scripts/build-app.sh release  # release
open macos/.build/FourspaceNative.app
```

The script runs `swift build`, wraps the executable in a minimal
`FourspaceNative.app` bundle with an `Info.plist`, and ad-hoc signs it so it
launches as a normal app.

### Headless probe

`--probe` runs a full round-trip without the UI, using the same client code:

```bash
FOURSPACE_URL=http://127.0.0.1:4611 \
FOURSPACE_TOKEN="$(t3 auth session issue --token-only ...)" \
macos/.build/debug/FourspaceNative --probe
```

It connects, loads config, creates a project + thread, starts a turn and prints
the streamed assistant text. Verified against Codex (returns
`fourspace-probe-ok`).

## Layers

```
App      — entry point, scene, menu commands, lifecycle
UI       — SwiftUI views; no protocol logic
Domain   — spaces, kinds, entries, pure rules
AI       — T3 wire client, connection facade, shared HarnessStore
Server   — local T3 server process lifecycle
Chat     — conversation streaming + Chat space
Projects — project list, create/import, project threads
Security — Keychain
```

Later phases add `Experiments`, `Products`, `Agents`, `Tools`, `Files`,
`Git`, `Browser`, `Scheduling`, `Usage`.

## Shared harness (Phase 7)

`HarnessStore` is created once at app launch and injected everywhere. It owns
the server lifecycle, the single `T3Connection`, the provider catalog and the
selected model, and exposes the orchestration calls (`loadShell`,
`openOrCreateWorkspace`, `createProject`, `createThread`, `startTurn`,
`subscribeThread`). `ChatViewModel` and `ProjectsViewModel` both depend on it,
so there is one server and one session regardless of which space is open.

`ConversationViewModel` streams exactly one thread and is reused by Chat and by
project threads. `MessageList`, `Composer`, `ModelPicker` and
`HarnessConnectView` are shared UI; a space never reimplements them.

On launch `RootView` connects the harness, opens the Chat workspace and
refreshes the project list.

## Projects (Phase 7)

- **Create New**: name + parent directory; the folder is created and registered
  (`project.create` with `createWorkspaceRootIfMissing`).
- **Import Existing**: a native `NSOpenPanel` picks a folder; it is registered
  with its absolute path as the workspace root and
  `createWorkspaceRootIfMissing: false`. The folder is **never moved or
  copied**.
- Selecting a project shows its root and threads; selecting or creating a
  thread opens the shared conversation surface with the shared model picker.

Project metadata lives in the T3 server's store; the folder on disk remains a
normal folder openable by any other harness.

## Harness client (Phase 4)

The native app does **not** reimplement providers or sessions. It speaks T3's
typed WebSocket API directly.

- **Transport.** Effect RPC with the JSON serialization
  (`RpcSerialization.layerJson`): one JSON envelope per WebSocket text frame.
  - client → server: `{"_tag":"Request","id":…,"tag":…,"payload":…,"headers":[]}`,
    plus `Ack` (required for stream backpressure) and `Interrupt`.
  - server → client: `{"_tag":"Chunk","requestId":…,"values":[…]}`,
    `{"_tag":"Exit","requestId":…,"exit":{…}}`, `Defect`, `Pong`.
  - `T3RpcClient` is an actor; unary calls resume a continuation, streams are
    `AsyncThrowingStream`s. Every `Chunk` is `Ack`ed so the server's latch
    releases the next one.
- **Auth.** The server accepts `Authorization: Bearer <token>` on the `/ws`
  upgrade (also cookies or `?wsTicket=`). The app stores the bearer token in
  the Keychain and reads it on launch.
- **Config.** `server.getConfig` yields the environment id, cwd and the
  provider catalog (driver, status, models).
- **Orchestration.** Commands are sent through
  `orchestration.dispatchCommand`: `project.create`, `thread.create`,
  `thread.turn.start`. `orchestration.subscribeShell` returns the project and
  thread summaries used to reuse a workspace; `orchestration.subscribeThread`
  streams snapshots and `thread.message-sent` events.
- **Streaming semantics.** A `thread.message-sent` event with
  `streaming: true` carries a **delta**; the view model appends it. A
  `streaming: false` event with empty text is the completion marker; one with
  text is a whole (non-streamed) message.

## Domain model (current)

`FourSpace.swift` defines:

- `FourSpace` — `.chat | .experiment | .project | .product`, with `title`,
  SF Symbol `symbol`, and discrete `accent` colour (royal blue / velvet violet
  / velvet green / warm orange).
- `GlobalDestination` — `.scheduled | .settings`.
- `RailSelection` — `.space(FourSpace) | .global(GlobalDestination)`.

`AppState` holds only the rail selection. `ChatViewModel` holds connection and
transcript state. Both are `@Observable` and injected via `.environment`.

## Shell

`RootView` uses a three-column `NavigationSplitView`:

1. **Rail** (`RailView`) — a sidebar `List` with a "Four Space" section and a
   global section. Selection is `RailSelection?`.
2. **Content** (`SpaceContentList`) — per-destination list.
3. **Detail** (`SpaceDetail`) — per-destination work surface; Chat renders
   `ChatView`.

Column widths are set with `navigationSplitViewColumnWidth`: rail 180–260
(ideal 205), content 260–420 (ideal 320).

## Server lifecycle

The app owns a local T3 server process. `ServerController` is the single place
that decides attach vs. spawn.

- **On connect:** if something already listens at the server URL, the app
  **attaches** and uses its stored token. Otherwise, for a loopback URL, it
  **spawns** `node <repo>/apps/server/src/bin.ts serve --port … --host
127.0.0.1 --base-dir <Application Support/FourSpace/server>`, waits until it
  is listening, and **mints** a bearer token by running the same entry with
  `auth session issue --token-only`.
- **On quit:** `AppDelegate.applicationWillTerminate` calls
  `ServerController.terminateCurrent()`, which stops **only the child it
  started**. An attached server is left running. Closing the last window quits
  the app (`applicationShouldTerminateAfterLastWindowClosed`).
- Server stdout/stderr go to `<base-dir>/server.log`.

Locations are dev-friendly and overridable:

| Setting      | Default                                                                                                   | Override                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Server entry | repo `apps/server/src/bin.ts` derived from `#filePath`                                                    | `FOURSPACE_SERVER_ENTRY` env or `fourspace.serverEntry` default |
| Node binary  | first of `/opt/homebrew/bin/node`, `/usr/local/bin/node`, vite-plus, `~/.local/bin/node`, `/usr/bin/node` | `FOURSPACE_NODE` env                                            |
| Base dir     | `~/Library/Application Support/FourSpace/server`                                                          | passed to the controller                                        |

The child's `PATH` is widened to include the node directory, `~/.local/bin`,
Homebrew and system paths, so provider CLIs (e.g. Codex) resolve when the app
is launched from Finder.

Verified: launching the app spawns the server and quitting stops it; a server
that was already running before launch survives the quit.

## Chat (Phase 4–6)

`ChatThreadList` fills the middle column with the Chat project's threads,
newest first, with relative timestamps and a New Chat button. `ChatView` shows
a connect form when disconnected (server URL + bearer token), and a transcript

- composer when connected. If a token is stored, the view auto-connects on
  first appearance.

`ChatViewModel.openChatWorkspace()` calls
`T3Connection.openOrCreateWorkspace(workspaceRoot:…)`, which is the single
implementation of Four Space's "adopt a folder" rule: reuse an existing
project whose root matches, else create it; reuse its most recent thread, else
create one. Both the app and the `--probe` path use it. The Chat root is
`~/FourSpace/Chat`.

The selected thread is subscribed via `orchestration.subscribeThread`; its
snapshot replaces the transcript and `thread.message-sent` events are applied
by message id (deltas append, completion clears `streaming`). When an
assistant message completes, the thread list is refreshed so generated titles
appear.

### Persistence

| Value             | Store          | Key                                                        |
| ----------------- | -------------- | ---------------------------------------------------------- |
| Server URL        | `UserDefaults` | `fourspace.serverURL`                                      |
| Bearer token      | Keychain       | service `codes.fourspace.native`, account `t3.bearerToken` |
| Selected provider | `UserDefaults` | `fourspace.selectedProviderId`                             |
| Selected model    | `UserDefaults` | `fourspace.selectedModelSlug`                              |
| Active thread     | `UserDefaults` | `fourspace.activeThreadId`                                 |

The active thread is restored only if it still exists in the shell; otherwise
the newest thread is selected. Chat _content_ is never stored natively — the
T3 server's event-sourced SQLite is the source of truth.

### Dev overrides

For automated verification, `FOURSPACE_URL` and `FOURSPACE_TOKEN` in the
environment override the stored values. A token supplied this way is treated
as dev-only and is **not** written to the Keychain.

## Relationship to T3 and Four Space Electron

- **Four Space Electron** is read-only product/UX facit. See
  `FOURSPACE-MIGRATION.md §2`.
- The native app talks to a **T3 server** over its typed WebSocket API for
  all harness capability. See `FOURSPACE-MIGRATION.md §4`.
- Four Spaces classification and structure are native; projects remain plain
  folders on disk.

## Decisions recorded

- SwiftPM (not an `.xcodeproj`) plus a bundling script, so builds are
  scriptable and reviewable. An Xcode project can be added later without
  changing the sources.
- `swift-tools-version: 6.0`, platform `.macOS(.v15)`.
- The native app lives under `macos/`; the repo-root `native/` directory is
  T3's vendored read-only references and is left alone.
- Dynamic `JSONValue` instead of mirroring the full contract now; typed models
  are introduced per phase where they earn their keep.
- `@main` lives on a small `Entry` type so the app can also run headless
  (`--probe`) using the same client code.
- Keychain is the secret store. Ad-hoc dev builds prompt for access when a
  credential was seeded by another process; the app creates its own item when
  the user connects, so normal use does not prompt.
