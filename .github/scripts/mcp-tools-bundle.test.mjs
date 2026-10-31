import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

test('the MCP tools bundle persists interactions without bundling the agent executor', async () => {
  const result = await build({
    absWorkingDir: fileURLToPath(new URL('../../', import.meta.url)),
    bundle: true,
    entryPoints: ['apps/server/src/routers/tools/mcp.ts'],
    format: 'esm',
    logLevel: 'silent',
    metafile: true,
    packages: 'external',
    platform: 'node',
    tsconfig: 'tsconfig.json',
    write: false,
  });
  const files = Object.keys(result.metafile.inputs);
  assert.ok(files.includes('apps/server/src/services/mcp/elicitation/McpElicitationService.ts'));
  assert.ok(
    !files.some((file) => file.includes('/agentRuntime/AgentRuntimeService/')),
    'MCP input storage must not import the complete agent executor into /trpc/tools',
  );
  assert.ok(!files.includes('apps/server/src/services/toolExecution/index.ts'));
});
