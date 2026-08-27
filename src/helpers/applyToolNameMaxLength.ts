import { setToolIdNamespace, setToolNameMaxLength } from '@lobechat/context-engine';

import { getServerConfigStoreState } from '@/store/serverConfig';

/**
 * Apply the deployment's tool-name-generation config before generating tool
 * names: `TOOL_NAME_MAX_LENGTH` (compression threshold) and
 * `BUILTIN_TOOL_ID_NAMESPACE` (the `lobe-` prefix rewrite that keeps a
 * white-label deployment's model from inferring "I am LobeHub" purely from
 * its own tool names).
 *
 * Both are server envs, but this app also generates tool names in the browser
 * (the client-driven chat path builds the tool payload, and mention hydration
 * writes tool names into the system prompt), where `process.env` isn't visible —
 * so the resolved values travel with the global server config and are pushed into
 * the context-engine module here, the client mirror of what the server does at
 * `createServerToolsEngine`.
 *
 * Deliberately called from the sites that generate names rather than once at
 * config load: the server config store is created on every page, including the
 * lightweight auth / popup shells, and importing the context engine there would
 * drag its whole module graph into those bundles.
 *
 * Idempotent. Does nothing until the store exists, so an already-applied value
 * is never reset back to the default.
 */
export const applyToolNameMaxLength = () => {
  const state = getServerConfigStoreState();
  if (!state) return;

  setToolNameMaxLength(state.serverConfig?.toolNameMaxLength);
  setToolIdNamespace(state.serverConfig?.toolIdNamespace);
};
