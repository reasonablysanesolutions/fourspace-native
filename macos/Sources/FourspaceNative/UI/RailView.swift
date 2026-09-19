import SwiftUI

/// Persistent left rail. Its only job is orientation: four spaces, then the
/// two global destinations.
struct RailView: View {
    @Binding var selection: RailSelection?

    var body: some View {
        List(selection: $selection) {
            Section("Four Space") {
                ForEach(FourSpace.allCases) { space in
                    Label {
                        Text(space.title)
                    } icon: {
                        Image(systemName: space.symbol)
                            .foregroundStyle(space.accent)
                    }
                    .tag(RailSelection.space(space))
                }
            }

            Section {
                ForEach(GlobalDestination.allCases) { destination in
                    Label(destination.title, systemImage: destination.symbol)
                        .tag(RailSelection.global(destination))
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Four Space")
        .navigationSplitViewColumnWidth(min: 180, ideal: 205, max: 260)
    }
}
