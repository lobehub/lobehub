# Tool UI Surfaces

A builtin tool can ship up to **six client-side surfaces**, each with a different role in the chat UI. Only `Inspector` is required; the other five are added on demand and registered in their own central files.

| Surface      | Required? | When the chat shows it                                                | Registered in                                 |
| ------------ | --------- | --------------------------------------------------------------------- | --------------------------------------------- |
| Inspector    | ✅ Always | Header strip of every tool call (one-line chip)                       | `packages/builtin-tools/src/inspectors.ts`    |
| Render       | Optional  | Rich result card below the header, after the call returns             | `packages/builtin-tools/src/renders.ts`       |
| Placeholder  | Optional  | Skeleton between "args streaming complete" and "result arrives"       | `packages/builtin-tools/src/placeholders.ts`  |
| Streaming    | Optional  | Live output during execution (e.g. command stdout)                    | `packages/builtin-tools/src/streamings.ts`    |
| Intervention | Optional  | Approval / edit-before-run dialog (when `humanIntervention` triggers) | `packages/builtin-tools/src/interventions.ts` |
| Portal       | Optional  | Full-screen detail view (right-side or modal)                         | `packages/builtin-tools/src/portals.ts`       |

The two reference tools to read end-to-end:

- **`builtin-tool-web-browsing/src/client/`** — Inspector + Render + Placeholder + Portal (no Intervention/Streaming).
- **`builtin-tool-local-system/src/client/`** — all six surfaces, including `components/` for shared building blocks.

---

## Files in this folder

Read **principles** and **shared-rules** first — they apply to every surface. Then jump to the surface you're building.

| File                               | What it covers                                                          |
| ---------------------------------- | ----------------------------------------------------------------------- |
| [principles.md](principles.md)     | Design principles — when each surface exists and how far to take it     |
| [shared-rules.md](shared-rules.md) | Cross-surface rules: component skeleton, styling, single-layer surfaces |
| [inspector.md](inspector.md)       | Inspector — header chip (required)                                      |
| [render.md](render.md)             | Render — rich result card                                               |
| [placeholder.md](placeholder.md)   | Placeholder — skeleton between args and result                          |
| [streaming.md](streaming.md)       | Streaming — live output during execution                                |
| [intervention.md](intervention.md) | Intervention — approval / edit-before-run                               |
| [portal.md](portal.md)             | Portal — full-screen detail view                                        |
| [composition.md](composition.md)   | Shared subcomponents (`client/components/`) + package public API        |
| [diagnostics.md](diagnostics.md)   | Symptom → surface quick-lookup                                          |
