import { createFileRoute } from "@tanstack/react-router";

import { FourSpacesSettingsPanel } from "../components/fourspaces/FourSpacesSettingsPanel";

export const Route = createFileRoute("/settings/four-spaces")({
  component: FourSpacesSettingsPanel,
});
