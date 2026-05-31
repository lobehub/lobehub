/**
 * Heterogeneous-agent (CC / Codex) working-directory segment names, relative to
 * `appStoragePath`. Kept in this side-effect-free module (no electron import)
 * so lightweight importers — the menu impls, the controller — get a single
 * source of truth without dragging in `@/const/dir`'s load-time `app.getPath`
 * calls.
 *
 * - `<HETERO_AGENT_DIR>/files`   — downloaded-file cache
 * - `<HETERO_AGENT_DIR>/tracing` — CLI trace sessions (packaged / opted-in)
 */
export const HETERO_AGENT_DIR = 'heteroAgent';
export const HETERO_AGENT_FILES_DIR = `${HETERO_AGENT_DIR}/files`;
export const HETERO_AGENT_TRACING_DIR = `${HETERO_AGENT_DIR}/tracing`;
