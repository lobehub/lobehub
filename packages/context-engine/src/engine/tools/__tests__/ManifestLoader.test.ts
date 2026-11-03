import { describe, expect, it } from 'vitest';

import { ToolResolver } from '../ToolResolver';
import type {
  ActivatedStepTool,
  LobeToolManifest,
  OperationToolSet,
  StepToolDelta,
} from '../types';

const mockCalcManifest: LobeToolManifest = {
  api: [
    {
      description: 'Calculate',
      name: 'calculate',
      parameters: { properties: {}, type: 'object' },
    },
  ],
  identifier: 'calculator',
  meta: { title: 'Calculator' },
  type: 'default',
};

const mockSearchManifest: LobeToolManifest = {
  api: [
    {
      description: 'Search',
      name: 'search',
      parameters: { properties: {}, type: 'object' },
    },
  ],
  identifier: 'web-search',
  meta: { title: 'Web Search' },
  type: 'builtin',
};

const emptyOpSet: OperationToolSet = {
  enabledToolIds: [],
  manifestMap: {},
  sourceMap: {},
  tools: [],
};

describe('P6: Runtime manifest extension via ToolResolver', () => {
  const resolver = new ToolResolver();

  it('should merge step delta manifest into resolved manifestMap', () => {
    const delta: StepToolDelta = {
      activatedTools: [{ id: 'calculator', manifest: mockCalcManifest, source: 'discovery' }],
    };

    const result = resolver.resolve(emptyOpSet, delta);

    expect(result.manifestMap['calculator']).toBeDefined();
    expect(result.tools).toHaveLength(1);
    expect(result.enabledToolIds).toContain('calculator');
  });

  it('should merge accumulated step activations with manifests', () => {
    const accumulated: ActivatedStepTool[] = [
      {
        activatedAtStep: 1,
        id: 'calculator',
        manifest: mockCalcManifest,
        source: 'discovery',
      },
      {
        activatedAtStep: 2,
        id: 'web-search',
        manifest: mockSearchManifest,
        source: 'discovery',
      },
    ];

    const result = resolver.resolve(emptyOpSet, { activatedTools: [] }, accumulated);

    expect(result.manifestMap['calculator']).toBeDefined();
    expect(result.manifestMap['web-search']).toBeDefined();
    expect(result.tools).toHaveLength(2);
    expect(result.enabledToolIds).toEqual(['calculator', 'web-search']);
  });

  it('should not override operation-level manifests with step-level ones', () => {
    const opSet: OperationToolSet = {
      enabledToolIds: ['web-search'],
      manifestMap: { 'web-search': mockSearchManifest },
      sourceMap: { 'web-search': 'builtin' },
      tools: [
        {
          function: { description: 'Search', name: 'web-search____search', parameters: {} },
          type: 'function',
        },
      ],
    };

    const modifiedManifest = { ...mockSearchManifest, meta: { title: 'Modified' } };
    const delta: StepToolDelta = {
      activatedTools: [{ id: 'web-search', manifest: modifiedManifest, source: 'discovery' }],
    };

    const result = resolver.resolve(opSet, delta);

    // Original manifest should be preserved (applyActivation skips existing)
    expect(result.manifestMap['web-search'].meta.title).toBe('Web Search');
    expect(result.tools).toHaveLength(1);
  });

  it('should skip activations without manifest (manifest not loaded)', () => {
    const delta: StepToolDelta = {
      activatedTools: [{ id: 'unknown-tool', source: 'discovery' }],
    };

    const result = resolver.resolve(emptyOpSet, delta);

    expect(result.manifestMap['unknown-tool']).toBeUndefined();
    expect(result.tools).toHaveLength(0);
  });

  it('should preserve manifests even when deactivated (for ToolNameResolver)', () => {
    const delta: StepToolDelta = {
      activatedTools: [{ id: 'calculator', manifest: mockCalcManifest, source: 'discovery' }],
      deactivatedToolIds: ['*'],
    };

    const result = resolver.resolve(emptyOpSet, delta);

    // Tools stripped, but manifest preserved
    expect(result.tools).toHaveLength(0);
    expect(result.manifestMap['calculator']).toBeDefined();
  });
});
