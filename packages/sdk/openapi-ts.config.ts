import type { IR } from '@hey-api/openapi-ts';
import { defineConfig } from '@hey-api/openapi-ts';

/**
 * SDK structure: `new LobeHub(...)` root instance with one resource group per
 * top-level path segment — `lobehub.agents.list()`, `lobehub.files.uploadBatch()`.
 *
 * The spec owns the names: every operationId is `<resource>.<method>` (see
 * `packages/openapi/src/common/operation-id.ts`), so nesting is a plain split.
 */
const nesting = (operation: IR.OperationObject): ReadonlyArray<string> => {
  const parts = operation.operationId?.split('.') ?? [];
  if (parts.length !== 2) {
    throw new Error(
      `${operation.method.toUpperCase()} ${operation.path}: operationId "${operation.operationId}" is not <resource>.<method>`,
    );
  }
  return parts;
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
