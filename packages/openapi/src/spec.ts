import { API_KEY_PREFIX } from '@lobechat/utils/apiKey';
import { generateSpecs } from 'hono-openapi';

import { API_KEY_SCOPES } from '@/const/apiKeyScope';

const HTTP_METHODS = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);

type GenerateSpecsApp = Parameters<typeof generateSpecs>[0];

interface OperationObject {
  operationId?: string;
  responses?: Record<string, unknown>;
  tags?: string[];
}

type SchemaObject = Record<string, unknown>;

const dateTime = { format: 'date-time', type: 'string' } as const;
const nullableString = { type: ['string', 'null'] } as const;
const nullableBoolean = { type: ['boolean', 'null'] } as const;
const nullableNumber = { type: ['number', 'null'] } as const;
const nullableObject = { additionalProperties: true, type: ['object', 'null'] } as const;

const resourceSchemas: Record<string, SchemaObject> = {
  ApiKey: {
    additionalProperties: false,
    properties: {
      createdAt: dateTime,
      enabled: nullableBoolean,
      expiresAt: { ...dateTime, type: ['string', 'null'] },
      id: { type: 'string' },
      lastUsedAt: { ...dateTime, type: ['string', 'null'] },
      name: { type: 'string' },
      scopes: { items: { enum: API_KEY_SCOPES, type: 'string' }, type: ['array', 'null'] },
      updatedAt: dateTime,
    },
    required: ['id', 'name', 'createdAt', 'updatedAt'],
    type: 'object',
  },
  Agent: {
    additionalProperties: false,
    properties: {
      avatar: nullableString,
      chatConfig: nullableObject,
      createdAt: dateTime,
      description: nullableString,
      id: { type: 'string' },
      model: nullableString,
      params: nullableObject,
      provider: nullableString,
      slug: nullableString,
      systemRole: nullableString,
      title: nullableString,
      updatedAt: dateTime,
    },
    required: ['id', 'createdAt', 'updatedAt'],
    type: 'object',
  },
  AgentGroup: {
    additionalProperties: false,
    properties: {
      createdAt: dateTime,
      id: { type: 'string' },
      name: { type: 'string' },
      sort: { type: ['integer', 'null'] },
      updatedAt: dateTime,
    },
    required: ['id', 'name', 'createdAt', 'updatedAt'],
    type: 'object',
  },
  ChatResponse: {
    additionalProperties: false,
    properties: {
      content: { type: 'string' },
      model: nullableString,
      provider: nullableString,
      usage: {
        additionalProperties: false,
        properties: {
          completion_tokens: { type: ['integer', 'null'] },
          prompt_tokens: { type: ['integer', 'null'] },
          total_tokens: { type: ['integer', 'null'] },
        },
        type: ['object', 'null'],
      },
    },
    required: ['content'],
    type: 'object',
  },
  EvalRun: {
    additionalProperties: false,
    properties: {
      createdAt: dateTime,
      datasetId: { type: 'string' },
      id: { type: 'string' },
      metrics: nullableObject,
      name: nullableString,
      startedAt: { ...dateTime, type: ['string', 'null'] },
      status: {
        enum: ['idle', 'pending', 'running', 'completed', 'failed', 'aborted', 'external'],
        type: 'string',
      },
      targetAgentId: nullableString,
      updatedAt: dateTime,
    },
    required: ['id', 'datasetId', 'status', 'createdAt', 'updatedAt'],
    type: 'object',
  },
  EvalRunResult: {
    additionalProperties: false,
    properties: {
      createdAt: dateTime,
      input: { type: 'string' },
      passed: nullableBoolean,
      result: nullableObject,
      score: nullableNumber,
      status: nullableString,
      testCaseId: { type: 'string' },
      topicId: { type: 'string' },
    },
    required: ['testCaseId', 'topicId', 'input', 'createdAt'],
    type: 'object',
  },
  File: {
    additionalProperties: true,
    properties: {
      createdAt: dateTime,
      fileType: { type: 'string' },
      id: { type: 'string' },
      metadata: nullableObject,
      name: { type: 'string' },
      parentId: nullableString,
      size: { type: 'integer' },
      source: nullableString,
      updatedAt: dateTime,
      url: { type: 'string' },
      visibility: { enum: ['private', 'public'], type: 'string' },
    },
    required: ['id', 'fileType', 'name', 'size', 'url', 'createdAt', 'updatedAt'],
    type: 'object',
  },
  KnowledgeBase: {
    additionalProperties: true,
    properties: {
      avatar: nullableString,
      createdAt: dateTime,
      description: nullableString,
      id: { type: 'string' },
      isPublic: nullableBoolean,
      name: { type: 'string' },
      settings: nullableObject,
      type: nullableString,
      updatedAt: dateTime,
      visibility: { enum: ['private', 'public'], type: 'string' },
    },
    required: ['id', 'name', 'createdAt', 'updatedAt'],
    type: 'object',
  },
  Message: {
    additionalProperties: true,
    properties: {
      agentId: nullableString,
      content: nullableString,
      createdAt: dateTime,
      error: nullableObject,
      favorite: nullableBoolean,
      id: { type: 'string' },
      metadata: nullableObject,
      model: nullableString,
      parentId: nullableString,
      provider: nullableString,
      reasoning: nullableObject,
      role: { type: 'string' },
      search: nullableObject,
      threadId: nullableString,
      tools: nullableObject,
      topicId: nullableString,
      updatedAt: dateTime,
      usage: nullableObject,
    },
    required: ['id', 'role', 'createdAt', 'updatedAt'],
    type: 'object',
  },
  McpServer: {
    additionalProperties: false,
    properties: {
      createdAt: dateTime,
      description: nullableString,
      hasCredentials: { type: 'boolean' },
      id: { format: 'uuid', type: 'string' },
      identifier: { type: 'string' },
      isEnabled: { type: 'boolean' },
      name: { type: 'string' },
      serverUrl: { format: 'uri', type: 'string' },
      status: { enum: ['connected', 'disconnected', 'error'], type: 'string' },
      tools: {
        items: {
          additionalProperties: false,
          properties: {
            description: nullableString,
            id: { format: 'uuid', type: 'string' },
            inputSchema: nullableObject,
            name: { type: 'string' },
            permission: { enum: ['auto', 'needs_approval', 'disabled'], type: 'string' },
          },
          required: ['id', 'name', 'permission'],
          type: 'object',
        },
        type: 'array',
      },
      updatedAt: dateTime,
    },
    required: [
      'id',
      'identifier',
      'name',
      'serverUrl',
      'status',
      'isEnabled',
      'hasCredentials',
      'tools',
      'createdAt',
      'updatedAt',
    ],
    type: 'object',
  },
  Model: {
    additionalProperties: false,
    properties: {
      abilities: nullableObject,
      config: nullableObject,
      contextWindowTokens: { type: ['integer', 'null'] },
      createdAt: dateTime,
      description: nullableString,
      displayName: nullableString,
      enabled: nullableBoolean,
      id: { type: 'string' },
      organization: nullableString,
      parameters: nullableObject,
      pricing: nullableObject,
      providerId: { type: 'string' },
      releasedAt: nullableString,
      settings: nullableObject,
      sort: { type: ['integer', 'null'] },
      source: nullableString,
      type: { type: 'string' },
      updatedAt: dateTime,
    },
    required: ['id', 'providerId', 'type', 'createdAt', 'updatedAt'],
    type: 'object',
  },
  Permission: {
    additionalProperties: false,
    properties: {
      category: { type: 'string' },
      code: { type: 'string' },
      createdAt: dateTime,
      description: nullableString,
      id: { type: 'string' },
      isActive: nullableBoolean,
      name: { type: 'string' },
      updatedAt: dateTime,
    },
    required: ['id', 'code', 'name', 'category', 'createdAt', 'updatedAt'],
    type: 'object',
  },
  Provider: {
    additionalProperties: false,
    properties: {
      checkModel: nullableString,
      config: nullableObject,
      createdAt: dateTime,
      description: nullableString,
      enabled: nullableBoolean,
      fetchOnClient: nullableBoolean,
      id: { type: 'string' },
      logo: nullableString,
      name: nullableString,
      settings: nullableObject,
      sort: { type: ['integer', 'null'] },
      source: nullableString,
      updatedAt: dateTime,
    },
    required: ['id', 'createdAt', 'updatedAt'],
    type: 'object',
  },
  Role: {
    additionalProperties: false,
    properties: {
      createdAt: dateTime,
      description: nullableString,
      displayName: { type: 'string' },
      id: { type: 'string' },
      isActive: nullableBoolean,
      isSystem: nullableBoolean,
      name: { type: 'string' },
      updatedAt: dateTime,
    },
    required: ['id', 'name', 'displayName', 'createdAt', 'updatedAt'],
    type: 'object',
  },
  Topic: {
    additionalProperties: true,
    properties: {
      agentId: nullableString,
      completedAt: { ...dateTime, type: ['string', 'null'] },
      content: nullableString,
      cost: nullableObject,
      createdAt: dateTime,
      description: nullableString,
      favorite: nullableBoolean,
      groupId: nullableString,
      historySummary: nullableString,
      id: { type: 'string' },
      metadata: nullableObject,
      mode: nullableString,
      model: nullableString,
      provider: nullableString,
      sessionId: nullableString,
      status: nullableString,
      title: nullableString,
      totalCost: nullableNumber,
      totalInputTokens: { type: ['integer', 'null'] },
      totalOutputTokens: { type: ['integer', 'null'] },
      totalTokens: { type: ['integer', 'null'] },
      trigger: nullableString,
      updatedAt: dateTime,
      usage: nullableObject,
    },
    required: ['id', 'createdAt', 'updatedAt'],
    type: 'object',
  },
  User: {
    additionalProperties: true,
    properties: {
      avatar: nullableString,
      createdAt: dateTime,
      email: nullableString,
      firstName: nullableString,
      fullName: nullableString,
      id: { type: 'string' },
      isOnboarded: nullableBoolean,
      lastName: nullableString,
      phone: nullableString,
      updatedAt: dateTime,
      username: nullableString,
    },
    required: ['id', 'createdAt', 'updatedAt'],
    type: 'object',
  },
  Usage: {
    additionalProperties: false,
    properties: {
      available: { type: 'boolean' },
      currency: { const: 'USD', type: 'string' },
      daily: {
        items: {
          additionalProperties: false,
          properties: { date: { type: 'string' }, value: { type: 'number' } },
          required: ['date', 'value'],
          type: 'object',
        },
        type: 'array',
      },
      period: {
        additionalProperties: false,
        properties: { since: dateTime, until: dateTime },
        required: ['since', 'until'],
        type: 'object',
      },
      remainingBalance: nullableNumber,
      scope: { enum: ['personal', 'workspace'], type: 'string' },
      spent: { type: 'number' },
      usageByType: {
        items: {
          additionalProperties: false,
          properties: {
            count: { type: ['integer', 'null'] },
            spend: { type: 'number' },
            type: { type: 'string' },
          },
          required: ['count', 'spend', 'type'],
          type: 'object',
        },
        type: 'array',
      },
    },
    required: [
      'available',
      'currency',
      'daily',
      'period',
      'remainingBalance',
      'scope',
      'spent',
      'usageByType',
    ],
    type: 'object',
  },
};

const groupResources: Record<string, { listKey: string; schema: string }> = {
  'agent-groups': { listKey: 'agentGroups', schema: 'AgentGroup' },
  'agents': { listKey: 'agents', schema: 'Agent' },
  'api-keys': { listKey: 'apiKeys', schema: 'ApiKey' },
  'files': { listKey: 'files', schema: 'File' },
  'knowledge-bases': { listKey: 'knowledgeBases', schema: 'KnowledgeBase' },
  'messages': { listKey: 'messages', schema: 'Message' },
  'mcp-servers': { listKey: 'mcpServers', schema: 'McpServer' },
  'models': { listKey: 'models', schema: 'Model' },
  'permissions': { listKey: 'permissions', schema: 'Permission' },
  'providers': { listKey: 'providers', schema: 'Provider' },
  'roles': { listKey: 'roles', schema: 'Role' },
  'topics': { listKey: 'topics', schema: 'Topic' },
  'users': { listKey: 'users', schema: 'User' },
  'usage': { listKey: 'usage', schema: 'Usage' },
};

const ref = (schema: string): SchemaObject => ({ $ref: `#/components/schemas/${schema}` });

const successEnvelope = (data: SchemaObject): SchemaObject => ({
  additionalProperties: false,
  properties: {
    data,
    message: { type: 'string' },
    success: { const: true, type: 'boolean' },
    timestamp: dateTime,
  },
  required: ['success', 'timestamp'],
  type: 'object',
});

const getSuccessSchema = (group: string, rest: string, method: string): SchemaObject => {
  if (group === 'health') {
    return {
      additionalProperties: false,
      properties: {
        service: { type: 'string' },
        status: { const: 'ok', type: 'string' },
        timestamp: dateTime,
      },
      required: ['service', 'status', 'timestamp'],
      type: 'object',
    };
  }

  if (group === 'responses') {
    return {
      additionalProperties: true,
      properties: {
        id: { type: 'string' },
        object: { const: 'response', type: 'string' },
        output: { items: { type: 'object' }, type: 'array' },
        status: { type: 'string' },
        usage: { type: ['object', 'null'] },
      },
      required: ['id', 'object', 'output', 'status'],
      type: 'object',
    };
  }

  if (group === 'chat') {
    if (rest === 'translate') {
      return successEnvelope({
        additionalProperties: false,
        properties: { translatedText: { type: 'string' } },
        required: ['translatedText'],
        type: 'object',
      });
    }

    if (rest === 'generate-reply') {
      return successEnvelope({
        additionalProperties: false,
        properties: { reply: { type: 'string' } },
        required: ['reply'],
        type: 'object',
      });
    }

    return successEnvelope(ref('ChatResponse'));
  }

  if (group === 'eval') {
    if (rest.endsWith('/results')) {
      return successEnvelope({
        additionalProperties: false,
        properties: {
          results: { items: ref('EvalRunResult'), type: 'array' },
          runId: { type: 'string' },
          total: { minimum: 0, type: 'integer' },
        },
        required: ['runId', 'total', 'results'],
        type: 'object',
      });
    }
    return successEnvelope(ref('EvalRun'));
  }

  const resource = groupResources[group];
  if (!resource) return successEnvelope({ additionalProperties: true, type: 'object' });

  if (group === 'usage') return successEnvelope(ref('Usage'));

  const isRootList = method === 'get' && rest === '';
  if (isRootList) {
    if (group === 'agent-groups' || group === 'api-keys' || group === 'mcp-servers') {
      return successEnvelope({ items: ref(resource.schema), type: 'array' });
    }

    return successEnvelope({
      additionalProperties: true,
      properties: {
        [resource.listKey]: { items: ref(resource.schema), type: 'array' },
        total: { minimum: 0, type: 'integer' },
      },
      required: [resource.listKey],
      type: 'object',
    });
  }

  if (method === 'delete') {
    return successEnvelope({ additionalProperties: true, type: ['object', 'null'] });
  }

  if (group === 'agent-groups' && method === 'post' && rest === '') {
    return successEnvelope({
      additionalProperties: false,
      properties: { id: { type: 'string' } },
      required: ['id'],
      type: 'object',
    });
  }

  if (group === 'api-keys' && method === 'post' && rest === '') {
    const apiKey = resourceSchemas.ApiKey as { properties: Record<string, unknown> };
    return successEnvelope({
      additionalProperties: false,
      properties: { ...apiKey.properties, key: { type: 'string' } },
      required: ['id', 'name', 'key', 'createdAt', 'updatedAt'],
      type: 'object',
    });
  }

  if (group === 'mcp-servers' && method === 'post' && rest.endsWith('/sync')) {
    return successEnvelope({
      additionalProperties: false,
      properties: {
        id: { format: 'uuid', type: 'string' },
        status: { const: 'connected', type: 'string' },
        toolCount: { minimum: 0, type: 'integer' },
      },
      required: ['id', 'status', 'toolCount'],
      type: 'object',
    });
  }

  // The file controllers wrap their payloads instead of returning the bare
  // resource, so the one-segment fallback below would advertise `File` and make
  // generated clients mistype every one of these. Keep these explicit.
  if (group === 'files') {
    const fileDetail: SchemaObject = {
      additionalProperties: false,
      properties: { file: ref('File'), parsed: { type: 'object' } },
      required: ['file'],
      type: 'object',
    };

    if ((method === 'post' && rest === '') || (method === 'get' && rest === '{id}')) {
      return successEnvelope(fileDetail);
    }

    if (method === 'post' && rest === 'batches') {
      return successEnvelope({
        additionalProperties: false,
        properties: {
          failed: {
            items: {
              additionalProperties: false,
              properties: { error: { type: 'string' }, name: { type: 'string' } },
              required: ['error', 'name'],
              type: 'object',
            },
            type: 'array',
          },
          successful: { items: fileDetail, type: 'array' },
          summary: {
            additionalProperties: false,
            properties: {
              failed: { minimum: 0, type: 'integer' },
              successful: { minimum: 0, type: 'integer' },
              total: { minimum: 0, type: 'integer' },
            },
            required: ['failed', 'successful', 'total'],
            type: 'object',
          },
        },
        required: ['failed', 'successful', 'summary'],
        type: 'object',
      });
    }

    if (method === 'post' && rest === 'queries') {
      return successEnvelope({
        additionalProperties: false,
        properties: {
          failed: {
            items: {
              additionalProperties: false,
              properties: { error: { type: 'string' }, fileId: { type: 'string' } },
              required: ['error', 'fileId'],
              type: 'object',
            },
            type: 'array',
          },
          files: { items: fileDetail, type: 'array' },
          success: { minimum: 0, type: 'integer' },
          total: { minimum: 0, type: 'integer' },
        },
        required: ['failed', 'files', 'success', 'total'],
        type: 'object',
      });
    }
  }

  if (group === 'messages' && rest === 'count') {
    return successEnvelope({
      additionalProperties: false,
      properties: { count: { minimum: 0, type: 'integer' } },
      required: ['count'],
      type: 'object',
    });
  }

  // Returns the created message, or nothing when generation produced no reply.
  if (group === 'messages' && rest === 'replies') {
    return successEnvelope({ anyOf: [ref('Message'), { type: 'null' }] });
  }

  // A caller without `user:read` deliberately receives only `{ id }`.
  if (group === 'users' && rest === 'me') {
    return successEnvelope({
      anyOf: [
        ref('User'),
        {
          additionalProperties: false,
          properties: { id: { type: 'string' } },
          required: ['id'],
          type: 'object',
        },
      ],
    });
  }

  // Only true resource operations get the resource schema: the collection root
  // and the `{id}` item. Every other single segment is a named sub-operation
  // (`count`, `me`, `batches`, …) whose payload is its own shape, so it must be
  // described explicitly above — falling back to a permissive object here keeps
  // an undescribed route merely vague rather than confidently wrong.
  const isResourceOperation = rest === '' || rest === '{id}';
  return isResourceOperation
    ? successEnvelope(ref(resource.schema))
    : successEnvelope({ additionalProperties: true, type: 'object' });
};

const errorResponse = (description: string) => ({
  content: { 'application/json': { schema: ref('ApiError') } },
  description,
});

/**
 * Build the OpenAPI 3.1 document from the live Hono app.
 *
 * Shared by the runtime `GET /api/v1/openapi.json` endpoint (see `app.ts`)
 * and the `scripts/generate-openapi.ts` emitter, so the served spec and the
 * committed `openapi.yml` always come from the same logic.
 */
export const buildSpecDocument = async (app: GenerateSpecsApp) => {
  const spec = await generateSpecs(app, {
    documentation: {
      components: {
        schemas: {
          ApiError: {
            additionalProperties: false,
            properties: {
              error: { type: 'string' },
              success: { const: false, type: 'boolean' },
              timestamp: dateTime,
            },
            required: ['error', 'success', 'timestamp'],
            type: 'object',
          },
          ...resourceSchemas,
        },
        securitySchemes: {
          bearerAuth: {
            bearerFormat: `API Key (${API_KEY_PREFIX}...) or OIDC JWT`,
            scheme: 'bearer',
            type: 'http',
          },
        },
      },
      info: {
        description:
          'LobeHub platform REST API. Generated from `packages/openapi` routes — do not edit openapi.yml by hand; run `bun generate:openapi` instead.',
        title: 'LobeHub API',
        version: '1.0.0',
      },
      security: [{ bearerAuth: [] }],
      servers: [{ description: 'LobeHub Cloud', url: 'https://app.lobehub.com' }],
    },
  });

  const paths = (spec.paths ?? {}) as Record<string, Record<string, OperationObject>>;

  for (const [path, item] of Object.entries(paths)) {
    // '/api/v1/agent-groups/{id}' -> group 'agent-groups', rest '{id}'
    const segments = path.replace(/^\/api\/v1\/?/, '').split('/');
    const group = segments[0] || 'root';
    const rest = segments.slice(1).join('/');

    for (const [method, op] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method.toUpperCase())) continue;

      op.tags ??= [group];
      op.operationId ??= `${group}.${method}${rest ? `_${rest.replaceAll(/[{}]/g, '').replaceAll('/', '_')}` : ''}`;
      op.responses ??= {};
      const successSchema = getSuccessSchema(group, rest, method);
      const successContent: Record<string, unknown> = {
        'application/json': { schema: successSchema },
      };
      if (group === 'responses') {
        successContent['text/event-stream'] = { schema: { type: 'string' } };
      }

      const successStatus =
        group === 'eval' && method === 'post' && rest === 'runs'
          ? 202
          : ['agent-groups', 'api-keys', 'mcp-servers'].includes(group) &&
              method === 'post' &&
              rest === ''
            ? 201
            : 200;
      const currentSuccess = (op.responses[successStatus] ?? {}) as Record<string, unknown>;
      op.responses[successStatus] = {
        ...currentSuccess,
        content: currentSuccess.content ?? successContent,
        description: currentSuccess.description ?? 'Successful response',
      };

      op.responses[400] ??= errorResponse('Invalid request');
      op.responses[401] ??= errorResponse('Authentication required');
      op.responses[403] ??= errorResponse('Insufficient permission');
      op.responses[404] ??= errorResponse('Resource not found');
      op.responses[409] ??= errorResponse('Resource conflict');
      op.responses[429] ??= errorResponse('Rate limit exceeded');
      op.responses[500] ??= errorResponse('Internal server error');

      for (const response of Object.values(op.responses)) {
        const responseObject = response as { description?: string };
        responseObject.description ??= 'Response';
      }
    }
  }

  return spec;
};
