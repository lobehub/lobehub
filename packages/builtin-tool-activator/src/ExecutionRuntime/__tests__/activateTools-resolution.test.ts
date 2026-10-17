import { Md5 } from 'ts-md5';
import { describe, expect, it, vi } from 'vitest';

import { ActivatorExecutionRuntime, type ToolManifestInfo } from '../index';

/**
 * Same truncation as the runtime's `hashSegment` (mirror of
 * `ToolNameResolver.genHash`): 12-char MD5 prefix.
 */
const wireHash = (segment: string): string =>
  `MD5HASH_${Md5.hashStr(segment).toString().slice(0, 12)}`;

const webBrowsingManifest: ToolManifestInfo = {
  apiDescriptions: [
    { description: 'Search the web.', name: 'search' },
    { description: 'Crawl one page.', name: 'crawlSinglePage' },
  ],
  identifier: 'lobe-web-browsing',
  name: 'Web Browsing',
};

const buildService = (manifests: ToolManifestInfo[]) => ({
  getActivatedToolIds: vi.fn(() => [] as string[]),
  getToolManifests: vi.fn(async (identifiers: string[]) =>
    manifests.filter((m) => identifiers.includes(m.identifier)),
  ),
  listToolManifests: vi.fn(async () => manifests),
  markActivated: vi.fn(),
});

describe('ActivatorExecutionRuntime.activateTools — request-name resolution', () => {
  it('resolves a wire name (identifier____apiName) to the plugin identifier', async () => {
    const service = buildService([webBrowsingManifest]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({
      identifiers: ['lobe-web-browsing____search'],
      reason: 'test',
    });

    expect(result.content).toContain('Successfully activated tools: lobe-web-browsing.search');
    expect(result.state?.notFound).toEqual([]);
    expect(service.markActivated).toHaveBeenCalledWith(['lobe-web-browsing']);
  });

  it('resolves a bare API name by loading the full discoverable list', async () => {
    // Codex P2 on PR #20791: the probe sends only the API name to the
    // identifier-keyed map (no manifests come back), so the unique bare-name
    // match must come from the host's full discoverable list.
    const service = buildService([webBrowsingManifest]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({ identifiers: ['search'], reason: 'test' });

    expect(service.getToolManifests).toHaveBeenCalledWith(['search']);
    expect(service.listToolManifests).toHaveBeenCalled();
    expect(result.content).toContain('Successfully activated tools: lobe-web-browsing.search');
    expect(result.state?.notFound).toEqual([]);
  });

  it('resolves a bare API name when the manifests were returned for the request', async () => {
    // The host's getToolManifests only matches plugin identifiers, so a bare
    // API name gets no manifests back — the resolver then passes it through.
    // This pins that behavior: bare names resolve only when the host returns
    // the manifest for them.
    const service = {
      getActivatedToolIds: vi.fn(() => [] as string[]),
      getToolManifests: vi.fn(async (identifiers: string[]) =>
        identifiers.includes('lobe-web-browsing') ? [webBrowsingManifest] : [],
      ),
      markActivated: vi.fn(),
    };
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({
      identifiers: ['lobe-web-browsing'],
      reason: 'test',
    });

    expect(result.content).toContain('Successfully activated tools: lobe-web-browsing.search');
  });

  it('resolves a wire name whose api segment is MD5-compressed to the identifier prefix', async () => {
    const service = buildService([webBrowsingManifest]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({
      identifiers: [`lobe-web-browsing____${wireHash('search')}`],
      reason: 'test',
    });

    expect(result.content).toContain('Successfully activated tools: lobe-web-browsing.search');
    expect(result.state?.notFound).toEqual([]);
  });

  it('still returns Not found for a name that matches no manifest', async () => {
    const service = buildService([webBrowsingManifest]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({
      identifiers: ['totally-unknown-tool'],
      reason: 'test',
    });

    expect(result.content).toContain('Not found: totally-unknown-tool');
    expect(result.state?.notFound).toEqual(['totally-unknown-tool']);
  });

  it('does not resolve an ambiguous bare API name shared by two manifests', async () => {
    const otherManifest: ToolManifestInfo = {
      apiDescriptions: [{ description: 'Search something else.', name: 'search' }],
      identifier: 'other-tool',
      name: 'Other Tool',
    };
    const service = buildService([webBrowsingManifest, otherManifest]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({ identifiers: ['search'], reason: 'test' });

    expect(result.content).toContain('Not found: search');
  });

  it('reports already-active for a wire name whose plugin is already activated', async () => {
    const service = buildService([webBrowsingManifest]);
    service.getActivatedToolIds.mockReturnValue(['lobe-web-browsing']);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({
      identifiers: ['lobe-web-browsing____search'],
      reason: 'test',
    });

    expect(result.content).toContain('Already active: lobe-web-browsing');
    expect(result.state?.notFound).toEqual([]);
  });

  it('keeps the exact plugin identifier working unchanged', async () => {
    const service = buildService([webBrowsingManifest]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({
      identifiers: ['lobe-web-browsing'],
      reason: 'test',
    });

    expect(result.content).toContain('Successfully activated tools: lobe-web-browsing.search');
  });

  it('deduplicates identifiers when one request carries two wire names of the same plugin', async () => {
    // Vent scenario (Codex P2 on PR #20791): the model asks for two APIs of
    // the same plugin; both resolve to the plugin identifier, and without dedup the
    // response would list the plugin (and its manifests/React keys) twice.
    const service = buildService([webBrowsingManifest]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({
      identifiers: ['lobe-web-browsing____search', 'lobe-web-browsing____crawlSinglePage'],
      reason: 'test',
    });

    expect(service.markActivated).toHaveBeenCalledTimes(1);
    expect(service.markActivated).toHaveBeenCalledWith(['lobe-web-browsing']);
    const occurrences = (result.content.match(/lobe-web-browsing\.search/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(result.state?.notFound).toEqual([]);
  });

  it('activates a tool requested by a wire name with an MD5-compressed api segment, mirroring ToolNameResolver variants', async () => {
    // Codex P2 on PR #20791: `ToolNameResolver.generate` compresses the api
    // segment to `MD5HASH_…` when the name is provider-invalid or over the
    // length cap; a request copied from `tools[]` must match that exact
    // variant instead of falling to the prefix probe.
    const service = buildService([webBrowsingManifest]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({
      identifiers: ['lobe-web-browsing____' + wireHash('search')],
      reason: 'test',
    });

    expect(result.content).toContain('Successfully activated tools: lobe-web-browsing.search');
    expect(result.state?.notFound).toEqual([]);
  });

  it('activates a tool requested by a wire name whose identifier segment is MD5-compressed', async () => {
    // Codex P2 on PR #20791: when the identifier makes the generated name
    // exceed the provider length cap, `ToolNameResolver.generate` hashes the
    // identifier segment too (`MD5HASH_xxx____MD5HASH_yyy`). The prefix probe
    // cannot invert it against the identifier-keyed map, so the host's
    // discoverable list is used to match hashed variants locally.
    const service = buildService([webBrowsingManifest]);
    service.listToolManifests = vi.fn(async () => [webBrowsingManifest]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({
      identifiers: [`${wireHash('lobe-web-browsing')}____${wireHash('search')}`],
      reason: 'test',
    });

    expect(service.listToolManifests).toHaveBeenCalled();
    expect(result.content).toContain('Successfully activated tools: lobe-web-browsing.search');
    expect(result.state?.notFound).toEqual([]);
  });

  it('does not activate a truncated-identifier prefix tool for a separator-free request', async () => {
    // Codex P2 on PR #20791: `identifiers: ['other-tool']` where another
    // discoverable plugin is literally named `other-too` — the old probe
    // derived `other-too` via `slice(0, -1)` and activated the wrong tool.
    // No manifest here exposes an API named `other-tool` and no manifest is
    // named `other-tool`, so a correct resolver has nothing to match.
    const prefixTool: ToolManifestInfo = {
      apiDescriptions: [{ description: 'An api.', name: 'unrelatedApi' }],
      identifier: 'other-too',
      name: 'Other Too',
    };
    const service = buildService([prefixTool]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({ identifiers: ['other-tool'], reason: 'test' });

    // `other-tool` is not a manifest identifier nor an API name; the
    // truncated prefix must not be probed, so the request cannot resolve to
    // `other-too`.
    expect(result.content).toContain('Not found: other-tool');
    expect(result.state?.notFound).toEqual(['other-tool']);
  });

  it('activates a tool requested by a bare API name unique to one manifest', async () => {
    // Separator-free request that IS a real API name resolves via the
    // discoverable list without ever slicing a truncated identifier.
    const prefixTool: ToolManifestInfo = {
      apiDescriptions: [{ description: 'An api.', name: 'other-tool' }],
      identifier: 'other-too',
      name: 'Other Too',
    };
    const service = buildService([prefixTool]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({ identifiers: ['other-tool'], reason: 'test' });

    expect(result.content).toContain('Successfully activated tools: other-too.other-tool');
    expect(result.state?.notFound).toEqual([]);
  });

  it('activates a hashed MCP wire name carrying a type segment', async () => {
    // Codex P2 on PR #20791: MCP/standalone manifests get a `____<type>`
    // segment from `ToolNameResolver.generate`, so a copied name for a
    // hashed MCP identifier is `MD5HASH_x____MD5HASH_y____mcp` — the type
    // must come through the manifest and match, not fall to the prefix probe.
    const mcpManifest: ToolManifestInfo = {
      apiDescriptions: [{ description: 'List issues.', name: 'listIssues' }],
      identifier: 'github-mcp',
      name: 'GitHub MCP',
      type: 'mcp',
    };
    const service = buildService([mcpManifest]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({
      identifiers: [`${wireHash('github-mcp')}____${wireHash('listIssues')}____mcp`],
      reason: 'test',
    });

    expect(result.content).toContain('Successfully activated tools: github-mcp.listIssues');
    expect(result.state?.notFound).toEqual([]);
  });

  it('activates a typed wire name even when the request dropped the type segment', async () => {
    // Tolerance path: a hashed MCP wire name without the `____mcp` suffix
    // still recovers the same tool through the untyped variant index.
    const mcpManifest: ToolManifestInfo = {
      apiDescriptions: [{ description: 'List issues.', name: 'listIssues' }],
      identifier: 'github-mcp',
      name: 'GitHub MCP',
      type: 'mcp',
    };
    const service = buildService([mcpManifest]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({
      identifiers: [`${wireHash('github-mcp')}____${wireHash('listIssues')}`],
      reason: 'test',
    });

    expect(result.content).toContain('Successfully activated tools: github-mcp.listIssues');
    expect(result.state?.notFound).toEqual([]);
  });

  it('activates the exact manifest identifier even when another plugin exposes an API with the same name', async () => {
    // Codex P2 on PR #20791: a plugin whose identifier equals another
    // plugin's API name must resolve to itself, not be hijacked by the
    // bare-API-name path.
    const impostor: ToolManifestInfo = {
      apiDescriptions: [{ description: 'A colliding api.', name: 'other-tool' }],
      identifier: 'impostor-plugin',
      name: 'Impostor Plugin',
    };
    const target: ToolManifestInfo = {
      apiDescriptions: [{ description: 'Target api.', name: 'targetApi' }],
      identifier: 'other-tool',
      name: 'Other Tool',
    };
    const service = buildService([impostor, target]);
    const runtime = new ActivatorExecutionRuntime({ service });

    const result = await runtime.activateTools({ identifiers: ['other-tool'], reason: 'test' });

    expect(result.content).toContain('Successfully activated tools: other-tool.targetApi');
    expect(result.state?.notFound).toEqual([]);
  });
});
