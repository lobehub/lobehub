import { describe, expect, it, vi } from 'vitest';

import {
  assembleManifestPool,
  buildConnectorManifest,
  patchManifestWithPermissions,
} from './manifestPool';

const manifest = (identifier: string, extra: Record<string, unknown> = {}) => ({
  api: [{ description: 'do it', name: 'run', parameters: {} }],
  identifier,
  meta: { title: identifier },
  ...extra,
});

describe('buildConnectorManifest', () => {
  it('lists every synced tool with its permission mapped, and nothing for a disabled or empty connector', () => {
    const built = buildConnectorManifest({
      identifier: 'notion',
      isEnabled: true,
      name: 'Notion',
      tools: [
        { description: 'search', permission: 'auto', toolName: 'search' },
        { permission: 'needs_approval', toolName: 'write' },
        { permission: 'disabled', toolName: 'delete' },
      ],
    })!;

    expect(built.identifier).toBe('notion');
    expect(built.type).toBe('mcp');
    expect(built.meta.description).toBe('Notion connector with 3 tools');
    expect(built.api.map((a) => [a.name, a.humanIntervention])).toEqual([
      ['search', undefined],
      ['write', 'required'],
      ['delete', 'required'],
    ]);
    expect(built.api[2].description).toContain('[TOOL DISABLED]');
    expect(built.api[1].parameters).toEqual({ properties: {}, type: 'object' });

    expect(
      buildConnectorManifest({ identifier: 'x', isEnabled: false, name: 'x', tools: [] }),
    ).toBeUndefined();
    expect(
      buildConnectorManifest({ identifier: 'x', isEnabled: true, name: 'x', tools: [] }),
    ).toBeUndefined();
  });

  it('leaves out tools whose MCP Apps visibility excludes the model', () => {
    const built = buildConnectorManifest({
      identifier: 'dashboard',
      isEnabled: true,
      name: 'Dashboard',
      tools: [
        { metadata: { visibility: ['model', 'app'] }, permission: 'auto', toolName: 'show' },
        { metadata: { visibility: ['app'] }, permission: 'auto', toolName: 'load_page' },
        { metadata: { visibility: ['model'] }, permission: 'auto', toolName: 'export' },
        { metadata: null, permission: 'auto', toolName: 'legacy' },
      ],
    })!;

    expect(built.api.map((a) => a.name)).toEqual(['show', 'export', 'legacy']);
    expect(built.meta.description).toBe('Dashboard connector with 3 tools');
  });

  // Auto-run and headless skip `required` but never `always`
  it('keeps a tool its manifest made mandatory on always, whatever its permission', () => {
    const mandatory = { mandatoryApproval: true };
    const built = buildConnectorManifest({
      identifier: 'cloud-mail',
      isEnabled: true,
      name: 'Cloud Mail',
      tools: [
        { metadata: mandatory, permission: 'needs_approval', toolName: 'send' },
        { metadata: { ...mandatory, visibility: ['model'] }, permission: 'auto', toolName: 'wipe' },
        { metadata: mandatory, permission: 'disabled', toolName: 'purge' },
        { metadata: { mandatoryApproval: 'yes' }, permission: 'auto', toolName: 'read' },
      ],
    })!;

    expect(built.api.map((a) => [a.name, a.humanIntervention])).toEqual([
      ['send', 'always'],
      ['wipe', 'always'],
      // Execution refuses a disabled tool regardless
      ['purge', 'required'],
      ['read', undefined],
    ]);
    expect(built.api[2].description).toContain('[TOOL DISABLED]');
  });

  it('builds nothing when every tool is for views only', () => {
    expect(
      buildConnectorManifest({
        identifier: 'dashboard',
        isEnabled: true,
        name: 'Dashboard',
        tools: [{ metadata: { visibility: ['app'] }, permission: 'auto', toolName: 'load_page' }],
      }),
    ).toBeUndefined();
  });
});

describe('patchManifestWithPermissions', () => {
  it('surfaces needs_approval and disabled on the matching api entries only', () => {
    const patched = patchManifestWithPermissions(
      {
        api: [
          { name: 'a', parameters: {} },
          { name: 'b', parameters: {} },
          { name: 'c', parameters: {} },
        ] as { description?: string; humanIntervention?: string; name: string; parameters: {} }[],
      },
      new Map([
        ['a', 'needs_approval'],
        ['b', 'disabled'],
      ]),
    );
    expect(patched.api[0]).toMatchObject({ humanIntervention: 'required' });
    expect(patched.api[1].description).toContain('[TOOL DISABLED]');
    expect(patched.api[2]).toEqual({ name: 'c', parameters: {} });
  });

  it("never loosens a manifest's own always into a required that auto-run skips", () => {
    const patched = patchManifestWithPermissions(
      {
        api: [
          { humanIntervention: 'always', name: 'a' },
          { humanIntervention: [{ match: { force: true }, policy: 'always' }], name: 'b' },
          { humanIntervention: { dynamic: { default: 'never', type: 'audit' } }, name: 'c' },
          { humanIntervention: 'required', name: 'd' },
          { name: 'e' },
          { humanIntervention: 'always', name: 'f' },
        ] as { humanIntervention?: unknown; name: string }[],
      },
      new Map([
        ['a', 'needs_approval'],
        ['b', 'needs_approval'],
        ['c', 'needs_approval'],
        ['d', 'needs_approval'],
        ['e', 'needs_approval'],
        ['f', 'auto'],
      ]),
    );

    expect(patched.api.map((a) => [a.name, a.humanIntervention])).toEqual([
      ['a', 'always'],
      ['b', 'always'],
      // A dynamic config's unset `policy` is `always` on a match
      ['c', 'always'],
      ['d', 'required'],
      ['e', 'required'],
      ['f', 'always'],
    ]);
  });

  it('reads a manifest-level always where the tool sets none, as the runtime does', () => {
    const patched = patchManifestWithPermissions(
      { api: [{ name: 'a' }], humanIntervention: 'always' },
      new Map([['a', 'needs_approval']]),
    );
    expect(patched.api[0]).toMatchObject({ humanIntervention: 'always' });
  });
});

describe('assembleManifestPool', () => {
  it('lets a connector manifest replace the same-named plugin and orders the sources', () => {
    const pool = assembleManifestPool({
      additional: [manifest('extra')],
      builtinTools: [{ identifier: 'lobe-x', manifest: manifest('lobe-x') as never }],
      composio: [manifest('gmail')],
      connectors: [manifest('notion', { type: 'mcp' })],
      installedPlugins: [manifest('notion'), manifest('plain-plugin')],
      lobehubSkills: [manifest('linear')],
    });

    expect(pool.connectorIdentifiers).toEqual(new Set(['notion']));
    expect(pool.manifests.map((m) => m.identifier)).toEqual([
      'plain-plugin',
      'lobe-x',
      'gmail',
      'linear',
      'notion',
      'extra',
    ]);
    expect(pool.manifests.find((m) => m.identifier === 'notion')?.type).toBe('mcp');
  });

  it('patches permissions onto manifests executed outside the connector path', () => {
    const pool = assembleManifestPool(
      {
        composio: [manifest('gmail')],
        installedPlugins: [manifest('community-mcp')],
        lobehubSkills: [manifest('linear')],
      },
      {
        connectorPermissions: new Map([
          ['community-mcp', new Map([['run', 'disabled']])],
          ['gmail', new Map([['run', 'needs_approval']])],
          ['linear', new Map()],
        ]),
      },
    );
    const byId = Object.fromEntries(pool.manifests.map((m) => [m.identifier, m]));
    expect(byId['community-mcp'].api[0].description).toContain('[TOOL DISABLED]');
    expect(byId['gmail'].api[0].humanIntervention).toBe('required');
    expect(byId['linear'].api[0].humanIntervention).toBeUndefined();
  });

  it('resolves context-aware builtins for the run and drops the ones that opt out', () => {
    const resolveManifest = vi.fn((ctx: { isSubAgent?: boolean }) =>
      ctx.isSubAgent
        ? null
        : manifest('lobe-agent', { api: [{ name: 'trimmed', parameters: {} }] }),
    );
    const builtinTools = [
      { identifier: 'lobe-agent', manifest: manifest('lobe-agent') as never, resolveManifest },
    ] as never;

    const contextFree = assembleManifestPool({ builtinTools });
    expect(contextFree.manifests[0].api[0].name).toBe('run');
    expect(resolveManifest).not.toHaveBeenCalled();

    const main = assembleManifestPool({ builtinTools }, { manifestContext: {} as never });
    expect(main.manifests[0].api[0].name).toBe('trimmed');

    const sub = assembleManifestPool(
      { builtinTools },
      { manifestContext: { isSubAgent: true } as never },
    );
    expect(sub.manifests).toEqual([]);
  });

  it('drops manifests without an api array and every excluded identifier from any source', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = assembleManifestPool(
      {
        additional: [manifest('lobe-remote-device')],
        composio: [{ identifier: 'broken', meta: {} } as never],
        installedPlugins: [manifest('gone'), manifest('kept'), undefined],
      },
      { excludedIdentifiers: ['gone', 'lobe-remote-device'] },
    );
    expect(pool.manifests.map((m) => m.identifier)).toEqual(['kept']);
    // Counts what the exclusion actually removed: both `gone` and the
    // device identifier were contributed by a source. An excluded id that
    // no source contributed must not inflate this.
    expect(pool.excludedCount).toBe(2);
    expect(
      assembleManifestPool(
        { installedPlugins: [manifest('kept')] },
        { excludedIdentifiers: ['never-here'] },
      ).excludedCount,
    ).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('composio'), [
      { identifier: 'broken', reason: 'missing `api` field (expected array)' },
    ]);
    warn.mockRestore();
  });
});
