/**
 * Readable `operationId`s: `<resource>.<method>`, e.g. `agents.list`,
 * `files.uploadBatch`. The SDK nests on these two parts verbatim
 * (`lobehub.agents.list()`), so an operationId is also a public SDK method name
 * and must never change once shipped.
 *
 * `<resource>` is the camelCased first path segment after `/api/v1`. The method
 * is derived from `{method} {path}` unless the route's `routeDoc()` declares
 * its own dotted `operationId` (for verbs the rule cannot express —
 * `notifications.markRead`, `tasks.run`):
 * - GET  collection            → list        GET  …/{id}          → get
 * - POST collection            → create      PATCH/PUT …/{id}     → update
 * - DELETE …/{id}              → delete
 * - extra static sub-segments are appended in PascalCase
 *   (GET …/{id}/chunks → listChunks, GET …/{id}/url → getUrl)
 */

export const OPERATION_ID_PATTERN = /^[a-z][\dA-Za-z]*\.[a-z][\dA-Za-z]*$/;

const pascal = (segment: string) =>
  segment
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const camel = (segment: string) => {
  const name = pascal(segment);
  return name.charAt(0).toLowerCase() + name.slice(1);
};

/** `/api/v1/knowledge-bases/{id}` → `knowledgeBases` */
export const operationResource = (path: string) =>
  camel(path.split('/').filter(Boolean)[2] ?? 'root');

/** The mechanical method name for `{method} {path}`. */
export const operationMethodName = (method: string, path: string): string => {
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

/**
 * Keep a route-declared dotted id (`files.uploadBatch`); replace hono-openapi's
 * generated default (`getApiV1AgentsById`) with the mechanical name.
 */
export const resolveOperationId = (method: string, path: string, declared?: string) =>
  declared?.includes('.')
    ? declared
    : `${operationResource(path)}.${operationMethodName(method, path)}`;
