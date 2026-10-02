import type { IR } from '@hey-api/openapi-ts';
import { defineConfig } from '@hey-api/openapi-ts';

/**
 * SDK structure: `new LobeHub(...)` root instance with one resource group per
 * top-level path segment — `lobehub.agents.list()`, `lobehub.files.uploadBatch()`.
 *
 * Method naming is a mechanical rule (derived from `{method} {path}`) plus
 * explicit overrides for the awkward cases:
 * - GET  collection            → list        GET  …/{id}          → get
 * - POST collection            → create      PATCH/PUT …/{id}     → update
 * - DELETE …/{id}              → delete
 * - extra static sub-segments are appended in PascalCase
 *   (GET …/{id}/chunks → listChunks, GET …/{id}/url → getUrl)
 */
const METHOD_NAME_OVERRIDES: Record<string, string> = {
  'DELETE /api/v1/knowledge-bases/{id}/files/batch': 'removeFiles',
  // batch delete of selected ids (body requires non-empty messageIds), not "all"
  'DELETE /api/v1/messages': 'deleteMany',
  'GET /api/v1/health': 'check',
  'GET /api/v1/users/me': 'me',
  'POST /api/v1/files/batches': 'uploadBatch',
  'POST /api/v1/files/queries': 'query',
  'POST /api/v1/files/{id}/parses': 'parse',
  'POST /api/v1/knowledge-bases/{id}/files/batch': 'addFiles',
  'POST /api/v1/knowledge-bases/{id}/files/move': 'moveFiles',
  'POST /api/v1/messages/replies': 'createReply',
  // Personal-agent sub-actions: the `{method} {path}` rule would call these
  // `createAdvance` / `createPause`, and the two memory DELETEs both reduce to
  // `delete` (colliding into `delete2`), so each needs an explicit name.
  'DELETE /api/v1/memories': 'deleteAll',
  // Agent identity assets under `/agents/{id}/accounts`: the mechanical rule
  // pluralizes the collection noun (`createAccounts`, `getAccounts`,
  // `updateAccountsCredential`), but each call acts on exactly one account.
  'POST /api/v1/agents/{id}/accounts': 'createAccount',
  'GET /api/v1/agents/{id}/accounts/{accountId}': 'getAccount',
  'PATCH /api/v1/agents/{id}/accounts/{accountId}': 'updateAccount',
  'PUT /api/v1/agents/{id}/accounts/{accountId}/credential': 'updateAccountCredential',
  'DELETE /api/v1/agents/{id}/accounts/{accountId}': 'deleteAccount',
  'DELETE /api/v1/memories/{category}/{id}': 'deleteEntry',
  'GET /api/v1/memories/{category}': 'listCategory',
  'GET /api/v1/notifications/counts': 'getCounts',
  'POST /api/v1/goals/{id}/advance': 'advance',
  'POST /api/v1/goals/{id}/pause': 'pause',
  'POST /api/v1/goals/{id}/restart': 'restart',
  'POST /api/v1/goals/{id}/resume': 'resume',
  'POST /api/v1/notifications/archive-all': 'archiveAll',
  'POST /api/v1/notifications/read': 'markRead',
  'POST /api/v1/notifications/read-all': 'markAllRead',
  'POST /api/v1/notifications/{id}/archive': 'archive',
  'POST /api/v1/signals/source-events': 'emit',
  'POST /api/v1/signals/trigger': 'trigger',
  // IM channel: `send` / `sync` / `markRead` read like a messaging client;
  // push tokens are keyed by device, so PUT/DELETE are register/unregister.
  'DELETE /api/v1/push-tokens/{deviceId}': 'unregister',
  'GET /api/v1/im/topics/{topicId}/sync': 'sync',
  'POST /api/v1/im/messages': 'send',
  'POST /api/v1/im/topics/{topicId}/read': 'markRead',
  'PUT /api/v1/push-tokens/{deviceId}': 'register',
};

const pascal = (segment: string) =>
  segment
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const camel = (segment: string) => {
  const name = pascal(segment);
  return name.charAt(0).toLowerCase() + name.slice(1);
};

const buildMethodName = (method: string, path: string): string => {
  const override = METHOD_NAME_OVERRIDES[`${method.toUpperCase()} ${path}`];
  if (override) return override;

  // '/api/v1/<resource-root>/<...rest>' — the resource group carries the root.
  const rest = path.split('/').filter(Boolean).slice(3);
  const statics = rest.filter((segment) => !segment.startsWith('{'));
  const endsWithParam = rest.length > 0 && rest.at(-1)!.startsWith('{');
  const suffix = statics.map(pascal).join('');

  switch (method.toUpperCase()) {
    case 'GET': {
      if (endsWithParam) return `get${suffix}`;
      if (statics.length === 0) return 'list';
      return `${statics.at(-1)!.endsWith('s') ? 'list' : 'get'}${suffix}`;
    }
    case 'POST': {
      return `create${suffix}`;
    }
    case 'PATCH':
    case 'PUT': {
      return `update${suffix}`;
    }
    case 'DELETE': {
      return `delete${suffix}`;
    }
    default: {
      return `${method.toLowerCase()}${suffix}`;
    }
  }
};

const nesting = (operation: IR.OperationObject): ReadonlyArray<string> => {
  const resource = camel(operation.path.split('/').filter(Boolean)[2]!);
  return [resource, buildMethodName(operation.method, operation.path)];
};

export default defineConfig({
  input: '../openapi/openapi.yml',
  output: 'src/generated',
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    {
      name: '@hey-api/sdk',
      operations: {
        container: 'class',
        containerName: 'LobeHub',
        methods: 'instance',
        nesting,
        strategy: 'single',
      },
    },
  ],
});
