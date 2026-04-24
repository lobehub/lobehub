import type { BuiltinToolManifest } from '@lobechat/types';
import type { JSONSchema7 } from 'json-schema';

import { systemPrompt } from './systemRole';
import { CredsApiName } from './types';

export const CredsIdentifier = 'lobe-creds';

export const CredsManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Connect a Klavis integration service via OAuth. Use this to authorize access to third-party services managed by the Klavis platform (e.g., Notion, Gmail, Google Calendar, Slack). Check the available Klavis services in the credentials context before calling this.',
      name: CredsApiName.connectKlavisService,
      parameters: {
        additionalProperties: false,
        properties: {
          service: {
            description:
              'The Klavis service identifier to connect (e.g., "notion", "gmail", "google-calendar"). See the available Klavis services list in the credentials context.',
            type: 'string',
          },
        },
        required: ['service'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Initiate OAuth connection flow for a third-party service (e.g., Linear, Microsoft Outlook, Twitter/X). Returns an authorization URL that the user must click to authorize. After authorization, the credential will be automatically saved.',
      name: CredsApiName.initiateOAuthConnect,
      parameters: {
        additionalProperties: false,
        properties: {
          provider: {
            description:
              'The OAuth provider ID. Available providers: "linear" (issue tracking), "microsoft" (Outlook Calendar), "twitter" (X/Twitter)',
            enum: ['linear', 'microsoft', 'twitter', 'github'],
            type: 'string',
          },
        },
        required: ['provider'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Retrieve the plaintext value of a stored credential by its key. Use this when you need to access a credential for making API calls or other operations. Only call this when you actually need the credential value.',
      name: CredsApiName.getPlaintextCred,
      parameters: {
        additionalProperties: false,
        properties: {
          key: {
            description: 'The unique key of the credential to retrieve',
            type: 'string',
          },
          reason: {
            description: 'Brief explanation of why this credential is needed (for audit purposes)',
            type: 'string',
          },
        },
        required: ['key'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Inject credentials into the sandbox environment as environment variables. Only available when sandbox mode is enabled. Use this before running code that requires credentials.',
      name: CredsApiName.injectCredsToSandbox,
      parameters: {
        additionalProperties: false,
        properties: {
          keys: {
            description: 'Array of credential keys to inject into the sandbox',
            items: {
              type: 'string',
            },
            type: 'array',
          },
        },
        required: ['keys'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Save a new credential securely. Use this when the user wants to store sensitive information like API keys, tokens, or secrets. The credential will be encrypted and stored securely.',
      name: CredsApiName.saveCreds,
      parameters: {
        additionalProperties: false,
        properties: {
          description: {
            description: 'Optional description explaining what this credential is used for',
            type: 'string',
          },
          key: {
            description:
              'Unique identifier key for the credential (e.g., "openai", "github-token"). Use lowercase with hyphens.',
            pattern: '^[a-z][a-z0-9-]*$',
            type: 'string',
          },
          name: {
            description: 'Human-readable display name for the credential',
            type: 'string',
          },
          type: {
            description: 'The type of credential being saved',
            enum: ['kv-env', 'kv-header'],
            type: 'string',
          },
          values: {
            additionalProperties: {
              type: 'string',
            },
            description:
              'Key-value pairs of the credential. For kv-env, the key should be the environment variable name (e.g., {"OPENAI_API_KEY": "sk-..."})',
            type: 'object',
          },
        },
        required: ['key', 'name', 'type', 'values'],
        type: 'object',
      } satisfies JSONSchema7,
    },
  ],
  identifier: CredsIdentifier,
  meta: {
    avatar: '🔐',
    description:
      'Manage user credentials for authentication, environment variable injection, and API verification. Use this tool when tasks require API keys, OAuth tokens, or secrets - such as calling third-party APIs, authenticating with external services, or injecting credentials into sandbox environments.',
    title: 'Credentials',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
