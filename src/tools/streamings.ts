import {
  CloudSandboxManifest,
  CloudSandboxStreamings,
} from '@lobechat/builtin-tool-cloud-sandbox/client';
import {
  GroupManagementManifest,
  GroupManagementStreamings,
} from '@lobechat/builtin-tool-group-management/client';
import { GTDManifest, GTDStreamings } from '@lobechat/builtin-tool-gtd/client';
import {
  LocalSystemManifest,
  LocalSystemStreamings,
} from '@lobechat/builtin-tool-local-system/client';
import { NotebookManifest, NotebookStreamings } from '@lobechat/builtin-tool-notebook/client';
import { type BuiltinStreaming } from '@lobechat/types';

/**
 * Builtin tools streaming renderer registry
 * Organized by toolset (identifier) -> API name
 *
 * Streaming components are used to render tool calls while they are
 * still executing, allowing real-time feedback to users.
 * The component should fetch streaming content from store internally.
 */
const BuiltinToolStreamings: Record<string, Record<string, BuiltinStreaming>> = {
  [CloudSandboxManifest.identifier]: CloudSandboxStreamings as Record<string, BuiltinStreaming>,
  [GroupManagementManifest.identifier]: GroupManagementStreamings as Record<
    string,
    BuiltinStreaming
  >,
  [GTDManifest.identifier]: GTDStreamings as Record<string, BuiltinStreaming>,
  [LocalSystemManifest.identifier]: LocalSystemStreamings as Record<string, BuiltinStreaming>,
  [NotebookManifest.identifier]: NotebookStreamings as Record<string, BuiltinStreaming>,
};

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

  const toolset = BuiltinToolStreamings[identifier];
  if (!toolset) return undefined;

  return toolset[apiName];
};
