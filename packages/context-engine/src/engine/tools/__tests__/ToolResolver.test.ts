import { describe, expect, it } from 'vitest';

import { ToolResolver } from '../ToolResolver';
import type {
  ActivatedStepTool,
  LobeToolManifest,
  OperationToolSet,
  StepToolDelta,
} from '../types';

// --- Mock manifests ---

const mockSearchManifest: LobeToolManifest = {
  api: [
    {
      description: 'Search the web',
      name: 'search',
      parameters: { properties: {}, type: 'object' },
    },
  ],
  identifier: 'web-search',
  meta: { title: 'Web Search' },
  type: 'builtin',
};

const mockCalcManifest: LobeToolManifest = {
  api: [
    {
      description: 'Calculate expression',
      name: 'calculate',
      parameters: { properties: {}, type: 'object' },
    },
  ],
  identifier: 'calculator',
  meta: { title: 'Calculator' },
  type: 'default',
};

const mockLocalSystemManifest: LobeToolManifest = {
  api: [
    {
      description: 'Run local command',
      name: 'run_command',
      parameters: { properties: {}, type: 'object' },
    },
    {
      description: 'Read file',
      name: 'read_file',
      parameters: { properties: {}, type: 'object' },
    },
  ],
  identifier: 'local-system',
  meta: { title: 'Local System' },
  type: 'builtin',
};

// --- Helpers ---

function makeOperationToolSet(manifests: LobeToolManifest[]): OperationToolSet {
  const manifestMap: Record<string, LobeToolManifest> = {};
  const sourceMap: Record<string, any> = {};
  const enabledToolIds: string[] = [];
  const tools: any[] = [];

  for (const m of manifests) {
    manifestMap[m.identifier] = m;
    enabledToolIds.push(m.identifier);
    sourceMap[m.identifier] = 'builtin';
    for (const api of m.api) {
      tools.push({
        function: {
          description: api.description,
          name: `${m.identifier}____${api.name}`,
          parameters: api.parameters,
        },
        type: 'function',
      });
    }
  }

  return { enabledToolIds, manifestMap, sourceMap, tools };
}

const emptyDelta: StepToolDelta = { activatedTools: [] };

describe('ToolResolver', () => {
  const resolver = new ToolResolver();

  describe('resolve with operation-only tools', () => {
    it('should return operation tools when no step delta', () => {
      const opSet = makeOperationToolSet([mockSearchManifest]);

      const result = resolver.resolve(opSet, emptyDelta);

      expect(result.tools).toHaveLength(1);
      expect(result.enabledToolIds).toEqual(['web-search']);
      expect(result.manifestMap['web-search']).toBeDefined();
    });

    it('should return empty tools for empty operation set', () => {
      const opSet = makeOperationToolSet([]);

      const result = resolver.resolve(opSet, emptyDelta);

      expect(result.tools).toHaveLength(0);
      expect(result.enabledToolIds).toEqual([]);
    });
  });

  describe('resolve with step activations', () => {
    it('should merge step-activated tools into result', () => {
      const opSet = makeOperationToolSet([mockSearchManifest]);
      const delta: StepToolDelta = {
        activatedTools: [
          { id: 'local-system', manifest: mockLocalSystemManifest, source: 'device' },
        ],
      };

      const result = resolver.resolve(opSet, delta);

      expect(result.tools).toHaveLength(3); // 1 search + 2 local-system
      expect(result.enabledToolIds).toContain('web-search');
      expect(result.enabledToolIds).toContain('local-system');
      expect(result.manifestMap['local-system']).toBeDefined();
    });

    it('should skip activation if tool already in operation set', () => {
      const opSet = makeOperationToolSet([mockSearchManifest]);
      const delta: StepToolDelta = {
        activatedTools: [{ id: 'web-search', manifest: mockSearchManifest, source: 'mention' }],
      };

      const result = resolver.resolve(opSet, delta);

      // Should not duplicate
      expect(result.tools).toHaveLength(1);
      expect(result.enabledToolIds).toEqual(['web-search']);
    });

    it('should skip activation without manifest', () => {
      const opSet = makeOperationToolSet([mockSearchManifest]);
      const delta: StepToolDelta = {
        activatedTools: [{ id: 'unknown-tool', source: 'mention' }],
      };

      const result = resolver.resolve(opSet, delta);

      expect(result.tools).toHaveLength(1);
      expect(result.manifestMap['unknown-tool']).toBeUndefined();
    });
  });

  describe('resolve with accumulated activations', () => {
    it('should apply accumulated activations from previous steps', () => {
      const opSet = makeOperationToolSet([mockSearchManifest]);
      const accumulated: ActivatedStepTool[] = [
        {
          activatedAtStep: 1,
          id: 'calculator',
          manifest: mockCalcManifest,
          source: 'active_tools',
        },
      ];

      const result = resolver.resolve(opSet, emptyDelta, accumulated);

      expect(result.tools).toHaveLength(2);
      expect(result.enabledToolIds).toContain('calculator');
      expect(result.manifestMap['calculator']).toBeDefined();
    });

    it('should not duplicate tools from accumulated + current delta', () => {
      const opSet = makeOperationToolSet([]);
      const accumulated: ActivatedStepTool[] = [
        {
          activatedAtStep: 1,
          id: 'calculator',
          manifest: mockCalcManifest,
          source: 'active_tools',
        },
      ];
      const delta: StepToolDelta = {
        activatedTools: [{ id: 'calculator', manifest: mockCalcManifest, source: 'mention' }],
      };

      const result = resolver.resolve(opSet, delta, accumulated);

      // calculator should appear only once
      expect(result.tools).toHaveLength(1);
      expect(result.enabledToolIds).toEqual(['calculator']);
    });
  });

  describe('deactivation', () => {
    it('should strip all tools when deactivatedToolIds contains wildcard', () => {
      const opSet = makeOperationToolSet([mockSearchManifest, mockCalcManifest]);
      const delta: StepToolDelta = {
        activatedTools: [],
        deactivatedToolIds: ['*'],
      };

      const result = resolver.resolve(opSet, delta);

      expect(result.tools).toHaveLength(0);
      expect(result.enabledToolIds).toHaveLength(0);
      // manifests should still be preserved for ToolNameResolver
      expect(result.manifestMap['web-search']).toBeDefined();
      expect(result.manifestMap['calculator']).toBeDefined();
    });
  });

  describe('deduplication', () => {
    it('should deduplicate tools with the same function name', () => {
      const opSet = makeOperationToolSet([mockSearchManifest]);
      // Manually push a duplicate tool
      opSet.tools.push({
        function: {
          description: 'Search the web (dup)',
          name: opSet.tools[0].function.name,
          parameters: {},
        },
        type: 'function',
      });

      const result = resolver.resolve(opSet, emptyDelta);

      expect(result.tools).toHaveLength(1);
    });

    it('should deduplicate enabledToolIds', () => {
      const opSet = makeOperationToolSet([mockSearchManifest]);
      opSet.enabledToolIds.push('web-search'); // duplicate

      const result = resolver.resolve(opSet, emptyDelta);

      expect(result.enabledToolIds).toEqual(['web-search']);
    });
  });

  describe('manifestMap should only contain enabled tools', () => {
    it('should exclude manifests not in enabledToolIds from resolved manifestMap', () => {
      // Simulate the bug: operationToolSet.manifestMap contains web-browsing,
      // but enabledToolIds does NOT (e.g. enableChecker filtered it out)
      const opSet = makeOperationToolSet([mockSearchManifest]);

      // Manually add a manifest that is NOT in enabledToolIds (simulating the bug)
      const webBrowsingManifest: LobeToolManifest = {
        api: [
          {
            description: 'Search the web',
            name: 'search',
            parameters: { properties: {}, type: 'object' },
          },
        ],
        identifier: 'lobe-web-browsing',
        meta: { title: 'Web Browsing' },
        systemRole: 'You have a Web Browsing tool...',
        type: 'builtin',
      };
      opSet.manifestMap['lobe-web-browsing'] = webBrowsingManifest;
      // Note: NOT added to enabledToolIds or tools

      const result = resolver.resolve(opSet, emptyDelta);

      // The resolved manifestMap should NOT contain lobe-web-browsing
      // because it's not in enabledToolIds
      expect(result.manifestMap['lobe-web-browsing']).toBeUndefined();
      expect(result.manifestMap['web-search']).toBeDefined();
      expect(result.enabledToolIds).toEqual(['web-search']);
    });

    it('should keep manifests for step-activated tools even if not in original enabledToolIds', () => {
      const opSet = makeOperationToolSet([mockSearchManifest]);
      const delta: StepToolDelta = {
        activatedTools: [
          { id: 'local-system', manifest: mockLocalSystemManifest, source: 'device' },
        ],
      };

      const result = resolver.resolve(opSet, delta);

      // local-system was step-activated, so it should be in both enabledToolIds and manifestMap
      expect(result.enabledToolIds).toContain('local-system');
      expect(result.manifestMap['local-system']).toBeDefined();
    });

    it('should preserve deactivated manifests only in wildcard deactivation', () => {
      // When forceFinish deactivates all tools, manifests are kept for ToolNameResolver
      const opSet = makeOperationToolSet([mockSearchManifest]);
      const delta: StepToolDelta = {
        activatedTools: [],
        deactivatedToolIds: ['*'],
      };

      const result = resolver.resolve(opSet, delta);

      expect(result.tools).toHaveLength(0);
      expect(result.enabledToolIds).toHaveLength(0);
      // Manifests preserved for ToolNameResolver in deactivation case
      expect(result.manifestMap['web-search']).toBeDefined();
    });
  });

  describe('defensive defaults for missing fields', () => {
    it('should handle undefined enabledToolIds gracefully', () => {
      // Simulate lambda path where enabledToolIds is not provided at runtime
      const opSet = {
        manifestMap: { 'web-search': mockSearchManifest },
        sourceMap: {},
      } as unknown as OperationToolSet;

      const result = resolver.resolve(opSet, emptyDelta);

      expect(result.enabledToolIds).toEqual([]);
      expect(result.tools).toEqual([]);
      // manifestMap should be empty since no enabledToolIds to match
      expect(Object.keys(result.manifestMap)).toHaveLength(0);
    });

    it('should handle undefined tools gracefully', () => {
      // Simulate partial toolSet missing tools array
      const opSet = {
        enabledToolIds: ['web-search'],
        manifestMap: { 'web-search': mockSearchManifest },
        sourceMap: {},
      } as unknown as OperationToolSet;

      const result = resolver.resolve(opSet, emptyDelta);

      expect(result.tools).toEqual([]);
      expect(result.enabledToolIds).toEqual(['web-search']);
      expect(result.manifestMap['web-search']).toBeDefined();
    });

    it('should handle both enabledToolIds and tools undefined without throwing', () => {
      const opSet = {
        manifestMap: {},
        sourceMap: {},
      } as unknown as OperationToolSet;

      expect(() => resolver.resolve(opSet, emptyDelta)).not.toThrow();

      const result = resolver.resolve(opSet, emptyDelta);
      expect(result.enabledToolIds).toEqual([]);
      expect(result.tools).toEqual([]);
    });
  });

  describe('immutability', () => {
    it('should not mutate the original operationToolSet', () => {
      const opSet = makeOperationToolSet([mockSearchManifest]);
      const originalToolCount = opSet.tools.length;
      const originalIds = [...opSet.enabledToolIds];

      const delta: StepToolDelta = {
        activatedTools: [
          { id: 'local-system', manifest: mockLocalSystemManifest, source: 'device' },
        ],
      };

      resolver.resolve(opSet, delta);

      expect(opSet.tools).toHaveLength(originalToolCount);
      expect(opSet.enabledToolIds).toEqual(originalIds);
      expect(opSet.manifestMap['local-system']).toBeUndefined();
    });
  });
});
