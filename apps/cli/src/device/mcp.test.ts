import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  disposeDeviceMcp,
  executeDeviceMcpCall,
  listDeviceMcpTools,
  readDeviceMcpUiResource,
} from './mcp';

const { resolveUserSpawnPath, uploadFileBuffer } = vi.hoisted(() => ({
  resolveUserSpawnPath: vi.fn(async () => process.env.PATH),
  uploadFileBuffer: vi.fn(async () => ({ url: 'https://files.example/frame.png' })),
}));

// The login-shell probe spawns the user's shell; the inherited PATH is enough here.
vi.mock('@lobechat/heterogeneous-agents/resolveCliCommand', () => ({ resolveUserSpawnPath }));
// Media blocks are uploaded through the server's file API; record the uploads only.
vi.mock('../utils/uploadLocalFile', () => ({ uploadFileBuffer }));

/** A real stdio MCP server exposing one `echo` tool; argv[2] records every spawn. */
const fixture = fileURLToPath(
  new URL('../../../../src/libs/mcp/__tests__/fixtures/legacyStdio.mjs', import.meta.url),
);

const stdioCall = (trace: string, env?: Record<string, string>) => ({
  apiName: 'echo',
  arguments: '{}',
  params: {
    args: [fixture, trace],
    command: process.execPath,
    env,
    name: 'echo-fixture',
    type: 'stdio' as const,
  },
});

const dirs: string[] = [];

/** A real stdio MCP Apps server: `show` renders a view, app-only `frame` returns an image. */
const appsFixture = fileURLToPath(
  new URL('../../../../src/libs/mcp/__tests__/fixtures/appsStdio.mjs', import.meta.url),
);
const appsParams = {
  args: [appsFixture],
  command: process.execPath,
  name: 'apps-fixture',
  type: 'stdio' as const,
};
const toolAuth = () => ({ accessToken: 'token', serverUrl: 'https://lobehub.test' }) as any;

afterEach(async () => {
  await disposeDeviceMcp();
  uploadFileBuffer.mockClear();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  resolveUserSpawnPath.mockClear();
});

describe('executeDeviceMcpCall', () => {
  it(
    'runs a tunneled stdio MCP tool on this machine and keeps its session across calls',
    { timeout: 20_000 },
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'cli-device-mcp-'));
      dirs.push(dir);
      const trace = path.join(dir, 'wire.txt');

      const first = await executeDeviceMcpCall(stdioCall(trace), () => undefined);
      const second = await executeDeviceMcpCall(stdioCall(trace), () => undefined);

      expect(first).toMatchObject({ content: 'Stdio MCP tool succeeded', success: true });
      expect(second).toMatchObject({ content: 'Stdio MCP tool succeeded', success: true });
      // One process served both calls: a stateful server keeps its state.
      const spawns = (await readFile(trace, 'utf8')).split('\n').filter((line) => line === 'spawn');
      expect(spawns).toHaveLength(1);
    },
  );

  it('spawns with the login-shell PATH unless the connector set its own', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cli-device-mcp-'));
    dirs.push(dir);

    await executeDeviceMcpCall(stdioCall(path.join(dir, 'a.txt')), () => undefined);
    expect(resolveUserSpawnPath).toHaveBeenCalledTimes(1);

    await executeDeviceMcpCall(
      stdioCall(path.join(dir, 'b.txt'), { PATH: process.env.PATH ?? '' }),
      () => undefined,
    );
    expect(resolveUserSpawnPath).toHaveBeenCalledTimes(1);
  });

  it('reports a server that cannot start as a failed call instead of throwing', async () => {
    const result = await executeDeviceMcpCall(
      {
        apiName: 'echo',
        arguments: '{}',
        params: {
          args: [],
          command: 'lobehub-missing-mcp-server-binary',
          name: 'missing',
          type: 'stdio',
        },
      },
      () => undefined,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('executeDeviceMcpCall with MCP Apps', () => {
  it(
    'marks the view of a result when the call announces MCP Apps',
    { timeout: 20_000 },
    async () => {
      const result = await executeDeviceMcpCall(
        { apiName: 'show', arguments: '{}', params: { ...appsParams, mcpCall: { mcpApps: true } } },
        toolAuth,
      );

      expect(result.success).toBe(true);
      expect((result.state as any)?.mcpApp).toMatchObject({
        resourceUri: 'ui://apps-fixture/view',
      });
    },
  );

  it(
    "runs a view's app-only call and returns its media inline, without uploading it",
    { timeout: 20_000 },
    async () => {
      const result = await executeDeviceMcpCall(
        {
          apiName: 'frame',
          arguments: '{}',
          params: { ...appsParams, mcpCall: { fromApp: true, mcpApps: true } },
        },
        toolAuth,
      );

      expect(result.success).toBe(true);
      const image = (result.state as any)?.content?.find((block: any) => block.type === 'image');
      expect(image?.data).toBe(Buffer.from('frame-bytes').toString('base64'));
      expect(uploadFileBuffer).not.toHaveBeenCalled();
    },
  );

  it("refuses a model call to a view's app-only tool", { timeout: 20_000 }, async () => {
    const result = await executeDeviceMcpCall(
      { apiName: 'frame', arguments: '{}', params: { ...appsParams, mcpCall: { mcpApps: true } } },
      toolAuth,
    );

    expect(result.success).toBe(false);
    expect(uploadFileBuffer).not.toHaveBeenCalled();
  });
});

describe('readDeviceMcpUiResource', () => {
  it('reads a view from the pooled session its calls run on', { timeout: 20_000 }, async () => {
    const result = await readDeviceMcpUiResource({
      params: appsParams,
      uri: 'ui://apps-fixture/view',
    });

    expect(result.contents[0]).toMatchObject({ text: '<p>apps fixture</p>' });
  });

  it('refuses anything but a ui:// resource', async () => {
    await expect(
      readDeviceMcpUiResource({ params: appsParams, uri: 'file:///etc/passwd' }),
    ).rejects.toThrow();
  });
});

describe('listDeviceMcpTools', () => {
  it(
    'lists a stdio server on the pooled session its tunneled calls then reuse',
    { timeout: 20_000 },
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'cli-device-mcp-'));
      dirs.push(dir);
      const trace = path.join(dir, 'wire.txt');
      const { params } = stdioCall(trace);

      const tools = await listDeviceMcpTools({ params });
      const call = await executeDeviceMcpCall(stdioCall(trace), () => undefined);

      // As listed, for the server to map like its own listings
      expect(tools.map((tool) => tool.name)).toEqual(['echo']);
      expect(tools[0].inputSchema).toBeDefined();
      expect(call).toMatchObject({ success: true });
      const spawns = (await readFile(trace, 'utf8')).split('\n').filter((line) => line === 'spawn');
      expect(spawns).toHaveLength(1);
    },
  );

  it('fails with the reason when the server cannot start', async () => {
    await expect(
      listDeviceMcpTools({
        params: {
          args: [],
          command: 'lobehub-missing-mcp-server-binary',
          name: 'x',
          type: 'stdio',
        },
      }),
    ).rejects.toThrow();
  });
});
