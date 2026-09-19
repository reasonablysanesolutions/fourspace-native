import SwiftUI

/// Top-level UI state. Deliberately small: the rail selection is the only
/// navigation state that exists before the domain layers land.
@Observable
final class AppState {
    var selection: RailSelection? = .space(.chat)
}
