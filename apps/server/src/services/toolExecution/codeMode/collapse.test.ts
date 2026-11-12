import { generateToolsFromManifest } from '@lobechat/context-engine';
import { disabledToolDescription } from '@lobechat/mecha';
import { describe, expect, it } from 'vitest';

import { applyCodeModeToToolSet, type CodeModeToolSet } from './collapse';
import { CODE_MODE_IDENTIFIER } from './constants';
import { getCodeModeToolIds } from './manifest';

const apiNames = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}_${i}`);

const mcpManifest = (identifier: string, names: string[], overrides: Record<string, any> = {}) => ({
  api: names.map((name) => ({
    description: `${name} description`,
    name,
    parameters: { type: 'object' },
  })),
  identifier,
  mcpParams: { name: identifier, type: 'http', url: 'https://example.com/mcp' },
  meta: { title: identifier },
  type: 'mcp' as const,
  ...overrides,
});

const builtinManifest = (identifier: string) => ({
  api: [{ description: 'search', name: 'search', parameters: { type: 'object' } }],
  identifier,
  meta: { title: identifier },
  type: 'builtin' as const,
});

const buildToolSet = (manifests: any[], extra: Partial<CodeModeToolSet> = {}): CodeModeToolSet => ({
  activatableToolIds: [],
  enabledToolIds: manifests.map((m) => m.identifier),
  executorMap: {},
  manifestMap: Object.fromEntries(manifests.map((m) => [m.identifier, m])),
  sourceMap: {},
  tools: manifests.flatMap((m) => generateToolsFromManifest(m)),
  ...extra,
});

const functionNames = (toolSet: CodeModeToolSet) => toolSet.tools!.map((t) => t.function.name);

describe('applyCodeModeToToolSet', () => {
  it('leaves a small tool set untouched', () => {
    const toolSet = buildToolSet([
      mcpManifest('github', apiNames('gh', 19)),
      builtinManifest('lobe-web-browsing'),
    ]);
    const before = structuredClone(toolSet);

    expect(applyCodeModeToToolSet(toolSet)).toBeUndefined();
    expect(toolSet).toEqual(before);
  });

  it('folds MCP connectors into the Code Mode tool once the threshold is reached', () => {
    const toolSet = buildToolSet([
      mcpManifest('github', apiNames('gh', 12)),
      mcpManifest('linear', apiNames('ln', 8)),
      builtinManifest('lobe-web-browsing'),
    ]);

    const result = applyCodeModeToToolSet(toolSet);

    expect(result).toEqual({ collapsedToolIds: ['github', 'linear'], toolCount: 20 });
    expect(toolSet.enabledToolIds).toEqual(['lobe-web-browsing', CODE_MODE_IDENTIFIER]);
    expect(functionNames(toolSet)).toEqual([
      'lobe-web-browsing____search',
      `${CODE_MODE_IDENTIFIER}____docs`,
      `${CODE_MODE_IDENTIFIER}____execute`,
    ]);
    // Folded manifests stay resolvable for execution.
    expect(toolSet.manifestMap.github).toBeDefined();
    expect(toolSet.sourceMap[CODE_MODE_IDENTIFIER]).toBe('builtin');
    expect(getCodeModeToolIds(toolSet.manifestMap)).toEqual(['github', 'linear']);

    const systemRole = toolSet.manifestMap[CODE_MODE_IDENTIFIER].systemRole!;
    expect(systemRole).toContain('- github (github): gh_0, gh_1');
    expect(systemRole).toContain('- linear (linear): ln_0');
  });

  it('shrinks the tool definitions sent to the model', () => {
    const toolSet = buildToolSet([mcpManifest('github', apiNames('gh', 40))]);
    const before = JSON.stringify(toolSet.tools).length;

    applyCodeModeToToolSet(toolSet);

    expect(JSON.stringify(toolSet.tools).length).toBeLessThan(before / 3);
  });

  it('keeps a connector with a tool that needs approval as separate functions', () => {
    const gated = mcpManifest('gmail', apiNames('gm', 10));
    (gated.api[0] as any).humanIntervention = 'required';
    const toolSet = buildToolSet([gated, mcpManifest('github', apiNames('gh', 20))]);

    const result = applyCodeModeToToolSet(toolSet);

    expect(result?.collapsedToolIds).toEqual(['github']);
    expect(toolSet.enabledToolIds).toContain('gmail');
    expect(functionNames(toolSet)).toContain('gmail____gm_0____mcp');
  });

  it('folds a connector whose disabled tools carry the blocking description, without advertising them', () => {
    const manifest = mcpManifest('github', apiNames('gh', 21));
    Object.assign(manifest.api[0], {
      description: disabledToolDescription('gh_0'),
      humanIntervention: 'required',
    });
    const toolSet = buildToolSet([manifest]);

    const result = applyCodeModeToToolSet(toolSet);

    expect(result).toEqual({ collapsedToolIds: ['github'], toolCount: 20 });
    expect(toolSet.manifestMap[CODE_MODE_IDENTIFIER].systemRole).not.toContain('gh_0,');
  });

  it('does not count disabled tools toward the threshold', () => {
    const manifest = mcpManifest('github', apiNames('gh', 20));
    manifest.api[0].description = disabledToolDescription('gh_0');

    expect(applyCodeModeToToolSet(buildToolSet([manifest]))).toBeUndefined();
  });

  it('skips client-dispatched and parameter-less MCP manifests', () => {
    const toolSet = buildToolSet(
      [
        mcpManifest('stdio-local', apiNames('st', 30)),
        mcpManifest('legacy', apiNames('lg', 30), { mcpParams: undefined }),
      ],
      { executorMap: { 'stdio-local': 'client' } },
    );

    expect(applyCodeModeToToolSet(toolSet)).toBeUndefined();
  });

  it('drops folded connectors from the historical activations', () => {
    const toolSet = buildToolSet([mcpManifest('github', apiNames('gh', 20))], {
      activatableToolIds: ['github', 'lobe-notebook'],
    });

    applyCodeModeToToolSet(toolSet);

    expect(toolSet.activatableToolIds).toEqual(['lobe-notebook']);
  });

  it('mutates the arrays in place so every holder of the tool set sees the result', () => {
    const toolSet = buildToolSet([mcpManifest('github', apiNames('gh', 20))]);
    const { enabledToolIds, tools } = toolSet;

    applyCodeModeToToolSet(toolSet);

    expect(toolSet.tools).toBe(tools);
    expect(toolSet.enabledToolIds).toBe(enabledToolIds);
    expect(tools).toHaveLength(2);
  });

  it('is a no-op on a tool set already folded', () => {
    const toolSet = buildToolSet([mcpManifest('github', apiNames('gh', 20))]);
    applyCodeModeToToolSet(toolSet);
    const after = structuredClone(toolSet);

    expect(applyCodeModeToToolSet(toolSet)).toBeUndefined();
    expect(toolSet).toEqual(after);
  });
});
