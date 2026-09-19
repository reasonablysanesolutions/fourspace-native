# Four Space Native — Architecture

Describes the **actual** native implementation as it exists. Update as the
app grows; do not record plans here (see `FOURSPACE-MIGRATION.md`).

## Status

Phase 2 complete and Phase 3 started: a real SwiftUI macOS app builds,
launches, and renders the Four Space shell (rail → content → detail).

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
      FourspaceNativeApp.swift      @main, scenes, menu commands
      AppState.swift                @Observable top-level UI state
    Domain/
      FourSpace.swift               FourSpace, GlobalDestination, RailSelection
    UI/
      RootView.swift                three-column shell
      RailView.swift                persistent left rail
      SpaceContentList.swift        middle column per destination
      SpaceDetail.swift             detail column
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

## Layers

```
App      — scene, menu commands, lifecycle
UI       — SwiftUI views; no domain logic
Domain   — spaces, kinds, entries, pure rules (grows per phase)
```

Later phases add `AI`, `Providers`, `Sessions`, `Chats`, `Experiments`,
`Projects`, `Products`, `Agents`, `Tools`, `Files`, `Git`, `Browser`,
`Scheduling`, `Usage`, `Persistence`, `Security`.

## Domain model (current)

`FourSpace.swift` defines:

- `FourSpace` — `.chat | .experiment | .project | .product`, with `title`,
  SF Symbol `symbol`, and discrete `accent` colour (royal blue / velvet violet
  / velvet green / warm orange).
- `GlobalDestination` — `.scheduled | .settings`.
- `RailSelection` — `.space(FourSpace) | .global(GlobalDestination)`.

`AppState` holds only the rail selection. It is `@Observable` and injected via
`.environment`.

## Shell

`RootView` uses a three-column `NavigationSplitView`:

1. **Rail** (`RailView`) — a sidebar `List` with a "Four Space" section and a
   global section. Selection is `RailSelection?`.
2. **Content** (`SpaceContentList`) — per-destination list.
3. **Detail** (`SpaceDetail`) — per-destination work surface.

Column widths are set with `navigationSplitViewColumnWidth`: rail 180–260
(ideal 205), content 260–420 (ideal 320). This mirrors the Electron rail/breadth
without copying web chrome.

## Relationship to T3 and Four Space Electron

- **Four Space Electron** is read-only product/UX facit. See
  `FOURSPACE-MIGRATION.md §2`.
- The native app will talk to a **T3 server** over its typed WebSocket API for
  all harness capability (providers, sessions, tools, schedules, usage). See
  `FOURSPACE-MIGRATION.md §4`.
- Four Spaces classification and structure are native; projects remain plain
  folders on disk.

## Decisions recorded

- SwiftPM (not an `.xcodeproj`) plus a bundling script, so builds are
  scriptable and reviewable. An Xcode project can be added later without
  changing the sources.
- `swift-tools-version: 6.0`, platform `.macOS(.v15)`.
- The native app lives under `macos/`; the repo-root `native/` directory is
  T3's vendored read-only references and is left alone.
