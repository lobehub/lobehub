import assert from 'node:assert/strict';

import {
  getMcpAppEntrypoints,
  resolveMcpUiResourceMeta,
  resolveMcpUiToolMeta,
} from '@lobechat/const/mcpApp';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { resolveDisplayMode } from '../../../src/features/MCPApp/displayMode';
import { createMcpAppsFixtureServer } from './server.mts';

const fixture = await createMcpAppsFixtureServer(0);
let sessionId: string | null = null;
let protocolVersion = '2025-11-25';

const rpc = async (method: string, params?: Record<string, unknown>) => {
  const response = await fetch(fixture.endpoint, {
    method: 'POST',
    headers: {
      'accept': 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      ...(sessionId ? { 'mcp-protocol-version': protocolVersion } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
  });

  assert.equal(response.status, 200, `${method} should return HTTP 200`);
  const negotiated = response.headers.get('mcp-protocol-version');
  if (negotiated) protocolVersion = negotiated;
  const assignedSessionId = response.headers.get('mcp-session-id');
  if (assignedSessionId) sessionId = assignedSessionId;
  return (await response.json()) as { result?: any; error?: any };
};

try {
  const initialized = await rpc('initialize', {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'mcp-apps-fixture-smoke', version: '1.0.0' },
  });
  assert.ok(initialized.result?.serverInfo?.name.includes('mcp-apps-acceptance-fixture'));
  assert.ok(sessionId, 'initialize must create an MCP session');

  const notification = await fetch(fixture.endpoint, {
    method: 'POST',
    headers: {
      'accept': 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-session-id': sessionId,
      'mcp-protocol-version': protocolVersion,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(notification.status, 202, 'initialized notification should be accepted');

  const listedTools = await rpc('tools/list');
  const tools = listedTools.result?.tools as Array<{ name: string; _meta?: Record<string, any> }>;
  assert.ok(tools?.length >= 11);
  const inline = tools.find(({ name }) => name === 'fixture_inline_preference');
  assert.deepEqual(resolveMcpUiToolMeta(inline?._meta), {
    resourceUri: 'ui://mcp-apps/resource-fullscreen-preference',
    preferredModelDisplayMode: 'inline',
  });
  const fullscreen = tools.find(({ name }) => name === 'fixture_fullscreen_preference');
  assert.equal(resolveMcpUiToolMeta(fullscreen?._meta).preferredModelDisplayMode, 'fullscreen');
  const defaultModeTool = tools.find(
    ({ name }) => name === 'fixture_resource_modes_no_tool_preference',
  );
  const defaultModeMeta = resolveMcpUiToolMeta(defaultModeTool?._meta);
  assert.equal(defaultModeMeta.preferredModelDisplayMode, undefined);
  assert.equal(defaultModeMeta.resourceUri, 'ui://mcp-apps/resource-modes-no-tool-preference');
  const thread = tools.find(({ name }) => name === 'fixture_thread_entrypoint');
  assert.deepEqual(resolveMcpUiToolMeta(thread?._meta).entrypoints, [{ type: 'thread' }]);
  assert.deepEqual(resolveMcpUiToolMeta(thread?._meta).visibility, ['app']);
  const legacy = tools.find(({ name }) => name === 'fixture_legacy_output_template');
  assert.equal(legacy?._meta?.['openai/outputTemplate'], 'ui://mcp-apps/legacy-output-template');
  const conflict = tools.find(({ name }) => name === 'fixture_ui_metadata_conflict');
  assert.deepEqual(resolveMcpUiToolMeta(conflict?._meta), {
    resourceUri: 'ui://mcp-apps/conflict-lobehub-winner',
    preferredModelDisplayMode: 'fullscreen',
    entrypoints: [{ type: 'thread' }],
  });
  assert.deepEqual(
    getMcpAppEntrypoints(tools as any, true).map(({ toolName }) => toolName),
    ['fixture_thread_entrypoint', 'fixture_ui_metadata_conflict'],
  );
  const appOnly = tools.find(({ name }) => name === 'fixture_app_only_tool');
  assert.deepEqual(appOnly?._meta?.ui?.visibility, ['app']);
  const caps = tools.find(({ name }) => name === 'fixture_resource_inline_only_caps');
  assert.equal(caps?._meta?.ui?.resourceUri, 'ui://mcp-apps/resource-inline-only-caps');
  const appCaps = tools.find(({ name }) => name === 'fixture_app_inline_only_caps');
  assert.equal(appCaps?._meta?.ui?.resourceUri, 'ui://mcp-apps/resource-app-inline-only-caps');

  const called = await rpc('tools/call', { name: 'fixture_inline_preference', arguments: {} });
  assert.equal(called.result?.structuredContent?.tool, 'fixture_inline_preference');

  const htmlResource = await rpc('resources/read', { uri: 'ui://mcp-apps/inline-preference' });
  const html = htmlResource.result?.contents?.[0]?.text as string;
  assert.ok(html.includes('ui/request-display-mode'));
  assert.ok(html.includes('ui/update-model-context'));
  assert.ok(html.includes('ui/notifications/request-teardown'));
  assert.ok(html.includes('ui/resource-teardown'));

  const defaultResource = await rpc('resources/read', {
    uri: 'ui://mcp-apps/resource-modes-no-tool-preference',
  });
  const resourceMeta = resolveMcpUiResourceMeta(defaultResource.result?.contents?.[0]?._meta);
  assert.deepEqual(resourceMeta.availableDisplayModes, ['inline', 'fullscreen']);
  assert.equal(resourceMeta.preferredDisplayMode, undefined);
  assert.equal(
    resolveDisplayMode({
      appModes: ['inline', 'fullscreen'],
      hostModes: ['inline', 'fullscreen'],
      resourceMeta,
    }),
    'fullscreen',
  );

  const conflictedPreferenceResource = await rpc('resources/read', {
    uri: 'ui://mcp-apps/resource-fullscreen-preference',
  });
  const conflictedResourceMeta = resolveMcpUiResourceMeta(
    conflictedPreferenceResource.result?.contents?.[0]?._meta,
  );
  assert.equal(conflictedResourceMeta.preferredDisplayMode, 'fullscreen');
  assert.equal(
    resolveDisplayMode({
      appModes: ['inline', 'fullscreen'],
      hostModes: ['inline', 'fullscreen'],
      resourceMeta: conflictedResourceMeta,
      toolPreferred: resolveMcpUiToolMeta(inline?._meta).preferredModelDisplayMode,
    }),
    'inline',
  );

  const secondClient = new Client({ name: 'mcp-apps-fixture-smoke-client-2', version: '1.0.0' });
  const thirdClient = new Client({ name: 'mcp-apps-fixture-smoke-client-3', version: '1.0.0' });
  const secondTransport = new StreamableHTTPClientTransport(new URL(fixture.endpoint));
  const thirdTransport = new StreamableHTTPClientTransport(new URL(fixture.endpoint));
  await secondClient.connect(secondTransport);
  await thirdClient.connect(thirdTransport);
  for (const [client, toolName, resourceUri] of [
    [secondClient, 'fixture_thread_entrypoint', 'ui://mcp-apps/thread-entrypoint'],
    [thirdClient, 'fixture_legacy_output_template', 'ui://mcp-apps/legacy-output-template'],
  ] as const) {
    const sdkTools = await client.listTools();
    assert.ok(sdkTools.tools.some(({ name }) => name === toolName));
    const result = await client.callTool({ name: toolName, arguments: {} });
    assert.equal((result.structuredContent as any)?.tool, toolName);
    const resource = await client.readResource({ uri: resourceUri });
    assert.ok(resource.contents[0]?.mimeType?.startsWith('text/html'));
  }
  const sessionsResponse = await fetch(`http://localhost:${fixture.port}/__fixture/sessions`);
  const sessions = (await sessionsResponse.json()) as { count: number; sessionIds: string[] };
  assert.ok(
    sessions.count >= 3,
    'raw client and two independent SDK clients use separate sessions',
  );
  assert.equal(new Set(sessions.sessionIds).size, sessions.count);
  const callTrace = (await fetch(`http://localhost:${fixture.port}/__fixture/calls`).then((r) =>
    r.json(),
  )) as {
    count: number;
    calls: Array<{ args: Record<string, unknown>; name: string }>;
  };
  assert.ok(callTrace.count >= 3);
  assert.ok(callTrace.calls.every(({ args }) => Object.keys(args).length === 0));

  console.log(
    `MCP Apps fixture smoke passed (${tools.length} tools, ${sessions.count} independent sessions).`,
  );
  await secondClient.close();
  await thirdClient.close();
} finally {
  await fixture.close();
}
