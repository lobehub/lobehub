import { type BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { CredentialsApiName, CredentialsIdentifier } from './types';

export const CredentialsManifest: BuiltinToolManifest = {
  api: [
    {
      description: 'Set or update a credential value at a keyVaults dot path.',
      humanIntervention: 'required',
      name: CredentialsApiName.setCredential,
      parameters: {
        additionalProperties: false,
        properties: {
          path: {
            description:
              'Dot path in keyVaults (e.g. "moltbook.apiKey" or compatibility path "sandboxEnv.MOLTBOOK_API_KEY")',
            type: 'string',
          },
          value: {
            description: 'Credential value to store',
            type: 'string',
          },
        },
        required: ['path', 'value'],
        type: 'object',
      },
    },
    {
      description: 'Get a credential by keyVaults dot path. Masked by default.',
      humanIntervention: 'required',
      name: CredentialsApiName.getCredential,
      parameters: {
        additionalProperties: false,
        properties: {
          path: {
            description:
              'Dot path in keyVaults (e.g. "moltbook.apiKey", "github.token", "sandboxEnv.MOLTBOOK_API_KEY")',
            type: 'string',
          },
          reveal: {
            description: 'Whether to reveal plaintext value in output',
            type: 'boolean',
          },
        },
        required: ['path'],
        type: 'object',
      },
    },
    {
      description: 'List credentials in keyVaults with masked values.',
      name: CredentialsApiName.listCredentials,
      parameters: {
        additionalProperties: false,
        properties: {
          prefix: {
            description:
              'Optional path prefix filter (e.g. "moltbook", "providers.github", "sandboxEnv")',
            type: 'string',
          },
        },
        type: 'object',
      },
    },
    {
      description: 'Delete a credential at a keyVaults dot path.',
      humanIntervention: 'required',
      name: CredentialsApiName.deleteCredential,
      parameters: {
        additionalProperties: false,
        properties: {
          path: {
            description:
              'Dot path in keyVaults (e.g. "moltbook.apiKey", "github.token", "sandboxEnv.MOLTBOOK_API_KEY")',
            type: 'string',
          },
        },
        required: ['path'],
        type: 'object',
      },
    },
  ],
  identifier: CredentialsIdentifier,
  meta: {
    avatar: '🔐',
    description: 'Manage encrypted credentials in keyVaults for runtime injection and automation',
    readme:
      'Use this tool to CRUD user credentials in keyVaults. For cloud sandbox command injection, prefer service-based paths (e.g. moltbook.apiKey); sandboxEnv.* remains compatible.',
    title: 'Credentials',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
