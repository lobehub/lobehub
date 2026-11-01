import type { BuiltinStreaming } from '@lobechat/types';

/**
 * Builtin tools streaming renderer registry
 * Organized by toolset (identifier) -> API name
 *
 * Streaming components are used to render tool calls while they are
 * still executing, allowing real-time feedback to users.
 * The component should fetch streaming content from store internally.
 */
const builtinToolStreamings: Record<string, Record<string, BuiltinStreaming>> = {};

export const registerBuiltinStreamings = (
  entries: Record<string, Record<string, BuiltinStreaming>>,
): void => {
  for (const [identifier, streamings] of Object.entries(entries)) {
    const current = builtinToolStreamings[identifier];
    builtinToolStreamings[identifier] = current ? Object.assign(current, streamings) : streamings;
  }
};

export interface BuiltinStreamingRegistryEntry {
  apiName: string;
  identifier: string;
  streaming: BuiltinStreaming;
}

export const listBuiltinStreamingEntries = (): BuiltinStreamingRegistryEntry[] =>
  Object.entries(builtinToolStreamings).flatMap(([identifier, toolset]) =>
    Object.entries(toolset)
      .filter((entry): entry is [string, BuiltinStreaming] => !!entry[1])
      .map(([apiName, streaming]) => ({
        apiName,
        identifier,
        streaming,
      })),
  );

/**
 * Get builtin streaming component for a specific API
 * @param identifier - Tool identifier (e.g., 'lobe-code-interpreter')
 * @param apiName - API name (e.g., 'executeCode')
 */
export const getBuiltinStreaming = (
  identifier?: string,
  apiName?: string,
): BuiltinStreaming | undefined => {
  if (!identifier || !apiName) return undefined;

  const toolset = builtinToolStreamings[identifier];
  if (!toolset) return undefined;

  return toolset[apiName];
};
