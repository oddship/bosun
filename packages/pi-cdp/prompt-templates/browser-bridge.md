---
description: Start browser annotation bridge for live page review
skill: cdp-browser-mesh, mesh
---

Start the CDP-mesh annotation bridge. Load the cdp-browser-mesh skill and follow its instructions to:

1. Start the bridge server in a split pane with your mesh agent name as `--target-agent`
2. Confirm the annotator UI is visible in the browser
3. Inform the user you're ready to receive annotations

The bridge script is at: `packages/pi-cdp/skills/cdp-browser-mesh/scripts/bridge-server.ts`

Example:
```bash
bun packages/pi-cdp/skills/cdp-browser-mesh/scripts/bridge-server.ts --target-agent <your-mesh-name>
```

$ARGUMENTS
