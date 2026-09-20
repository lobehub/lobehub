import type { BuiltinRestrictedManifestResolver, LobeChatPluginApi } from '@lobechat/types';

import { agentShareSystemPrompt } from './agentShareSystemRole';
import { AgentDocumentsManifest } from './manifest';
import { AGENT_SHARE_DOCUMENT_API_NAMES, AgentDocumentsApiName } from './types';

const matchesExactApiSet = (apiNames: readonly string[], expected: ReadonlySet<string>) => {
  const actual = new Set(apiNames);

  return actual.size === expected.size && [...actual].every((apiName) => expected.has(apiName));
};

const getApi = (name: string): LobeChatPluginApi => {
  const api = AgentDocumentsManifest.api.find((item) => item.name === name);

  if (!api) throw new Error(`Agent Documents manifest is missing ${name}`);

  return api;
};

const createDocumentApi: LobeChatPluginApi = {
  ...getApi(AgentDocumentsApiName.createDocument),
  description: 'Create a document in the current shared-agent topic.',
  parameters: {
    properties: {
      content: getApi(AgentDocumentsApiName.createDocument).parameters.properties.content,
      title: getApi(AgentDocumentsApiName.createDocument).parameters.properties.title,
    },
    required: ['title', 'content'],
    type: 'object',
  },
};

const listDocumentsApi: LobeChatPluginApi = {
  ...getApi(AgentDocumentsApiName.listDocuments),
  description: 'List documents created during the current shared-agent topic.',
  parameters: {
    properties: {},
    required: [],
    type: 'object',
  },
};

const agentShareApiOverrides = new Map<string, LobeChatPluginApi>([
  [AgentDocumentsApiName.createDocument, createDocumentApi],
  [AgentDocumentsApiName.listDocuments, listDocumentsApi],
]);

/**
 * Owns the temporary Agent Share projection of Documents capabilities.
 *
 * Keeping the semantic projection in this package prevents Share orchestration
 * from learning Documents-specific arguments and makes a future common tool
 * finalization pipeline a registry wiring change rather than another rewrite.
 */
export const resolveAgentDocumentsRestrictedManifest: BuiltinRestrictedManifestResolver = ({
  allowedApiNames,
  restriction,
}) => {
  if (
    restriction !== 'agentShare' ||
    !matchesExactApiSet(allowedApiNames, AGENT_SHARE_DOCUMENT_API_NAMES)
  ) {
    return undefined;
  }

  return {
    ...AgentDocumentsManifest,
    api: AgentDocumentsManifest.api
      .filter((api) => AGENT_SHARE_DOCUMENT_API_NAMES.has(api.name))
      .map((api) => agentShareApiOverrides.get(api.name) ?? api),
    meta: {
      ...AgentDocumentsManifest.meta,
      description:
        'Create, list, read, edit, and rename documents isolated to the current shared-agent topic.',
    },
    systemRole: agentShareSystemPrompt,
  };
};
