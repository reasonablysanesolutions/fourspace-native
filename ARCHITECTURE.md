# Four Space Native — Architecture

Describes the **actual** native implementation as it exists. Update as the
app grows; do not record plans here (see `FOURSPACE-MIGRATION.md`).

## Status

Phase 4 complete: the app connects to a live T3 server over WebSocket, loads
the provider/model catalog, creates or reuses a Chat workspace, starts a turn
and streams the assistant response end-to-end. Phase 3 shell is in place.

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
      FourspaceNativeApp.swift      App scene, menu commands
      AppState.swift                @Observable top-level UI state
    Domain/
      FourSpace.swift               FourSpace, GlobalDestination, RailSelection
    AI/
      JSONValue.swift               dynamic JSON for the wire protocol
      T3RpcClient.swift             Effect RPC over WebSocket (JSON envelopes)
      T3Connection.swift            typed facade + orchestration commands
    Chat/
      ChatViewModel.swift           connect / send / stream state
    Security/
      Keychain.swift                generic-password Keychain wrapper
    Debug/
      Probe.swift                   headless round-trip (`--probe`)
    UI/
      RootView.swift                three-column shell
      RailView.swift                persistent left rail
      SpaceContentList.swift        middle column per destination
      SpaceDetail.swift             detail column
      ChatView.swift                live chat surface
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
AI       — T3 wire client, connection facade, command builders
Chat     — chat view model (connect, send, stream)
Security — Keychain
```

Later phases add `Providers`, `Sessions`, `Experiments`, `Projects`,
`Products`, `Agents`, `Tools`, `Files`, `Git`, `Browser`, `Scheduling`,
`Usage`, `Persistence`.

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

## Chat (Phase 4)

`ChatView` shows a connect form when disconnected (server URL + bearer token),
and a transcript + composer when connected. If a token is stored, the view
auto-connects on first appearance.

On first send the view model opens a hidden Chat workspace at
`~/FourSpace/Chat`: it loads the shell, reuses an existing project with that
root and its most recent thread, or creates them, then subscribes to the
thread and dispatches the turn. The default runtime mode is `full-access`, so
no approval round-trips are needed yet.

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

