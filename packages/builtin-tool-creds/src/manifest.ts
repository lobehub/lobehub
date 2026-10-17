import type { BuiltinToolManifest } from '@lobechat/types';
import type { JSONSchema7 } from 'json-schema';

import { systemPrompt } from './systemRole';
import { CredsApiName, LOBEHUB_OAUTH_PROVIDER_IDS, LOBEHUB_OAUTH_PROVIDER_LIST } from './types';

export const CredsIdentifier = 'lobe-creds';

export const CredsManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Connect a Composio integration service via OAuth. Use this to authorize access to third-party services managed by the Composio platform (e.g., Gmail, Google Calendar, Slack). Check the available Composio services in the credentials context before calling this.',
      name: CredsApiName.connectComposioService,
      parameters: {
        additionalProperties: false,
        properties: {
          service: {
            description:
              'The Composio service identifier to connect (e.g., "gmail", "google-calendar"). See the available Composio services list in the credentials context.',
            type: 'string',
          },
        },
        required: ['service'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Initiate OAuth connection flow for a LobeHub Skill provider (e.g., GitHub, Linear, Microsoft Outlook, Notion, Twitter/X). Returns an authorization URL that the user must click to authorize. After authorization, the credential will be automatically saved.',
      name: CredsApiName.initiateOAuthConnect,
      parameters: {
        additionalProperties: false,
        properties: {
          provider: {
            description: `The OAuth provider ID. Available providers: ${LOBEHUB_OAUTH_PROVIDER_LIST}`,
            enum: [...LOBEHUB_OAUTH_PROVIDER_IDS],
            type: 'string',
          },
        },
        required: ['provider'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Inject credentials into the cloud sandbox environment as environment variables. Only useful when the sandbox is reachable this run — check "Cloud sandbox reachable for credential injection" in the session context before calling this. A routed device does not by itself rule this out: in auto mode the cloud sandbox stays reachable alongside a routed device, so the session-context value is the source of truth, not device-routing status alone.',
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
        'Ask the user to enter a credential in a secure form, then store it encrypted. You only name the credential and its fields; the user types the values into the form, which saves them directly. The values never appear in this conversation, so never ask the user to paste a secret into the chat. Reusing an existing key lets the user update that credential.',
      humanIntervention: 'always',
      name: CredsApiName.requestCredsInput,
      parameters: {
        additionalProperties: false,
        properties: {
          description: {
            description: 'Optional description explaining what this credential is used for',
            type: 'string',
          },
          fieldNames: {
            description:
              'Names of the values the user should fill in. For kv-env, the environment variable names (e.g., ["OPENAI_API_KEY"]); for kv-header, the header names (e.g., ["Authorization"]).',
            items: {
              pattern: '^[A-Za-z_][A-Za-z0-9_-]*$',
              type: 'string',
            },
            maxItems: 10,
            minItems: 1,
            type: 'array',
            uniqueItems: true,
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
        },
        required: ['key', 'name', 'type', 'fieldNames'],
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
