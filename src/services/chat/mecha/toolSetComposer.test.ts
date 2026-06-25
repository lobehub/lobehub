import { LobeAgentApiName, LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import type { LobeToolManifest, ToolsGenerationResult } from '@lobechat/context-engine';
import { generateToolsFromManifest } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import { composeEnabledTools } from './toolSetComposer';

const makeManifest = (identifier: string, apiName: string): LobeToolManifest => ({
  api: [
    {
      description: `${identifier}.${apiName}`,
      name: apiName,
      parameters: { properties: {}, type: 'object' },
    },
  ],
  identifier,
  meta: { avatar: '🔧', description: identifier, title: identifier },
  systemRole: '',
  type: 'builtin',
});

const makeToolsDetailed = (manifests: LobeToolManifest[]): ToolsGenerationResult => ({
  enabledManifests: manifests,
  enabledToolIds: manifests.map((m) => m.identifier),
  filteredTools: [],
  tools: manifests.length > 0 ? manifests.flatMap((m) => generateToolsFromManifest(m)) : undefined,
});

const makeMultiApiManifest = (identifier: string, apiNames: string[]): LobeToolManifest => ({
  api: apiNames.map((name) => ({
    description: `${identifier}.${name}`,
    name,
    parameters: { properties: {}, type: 'object' },
  })),
  identifier,
  meta: { avatar: '🔧', description: identifier, title: identifier },
  systemRole: '',
  type: 'builtin',
});

const PAGE_AGENT_MANIFEST = makeManifest(PageAgentIdentifier, 'initPage');
const OTHER_MANIFEST = makeManifest('lobe-agent-documents', 'readDocument');
// Mirrors the real lobe-agent manifest: callSubAgent bundled with plan/todo APIs.
const LOBE_AGENT_MANIFEST = makeMultiApiManifest(LobeAgentIdentifier, [
  LobeAgentApiName.createPlan,
  LobeAgentApiName.createTodos,
  LobeAgentApiName.callSubAgent,
]);
const subAgentToolName = `${LobeAgentIdentifier}____${LobeAgentApiName.callSubAgent}`;

describe('composeEnabledTools', () => {
  describe('mergeInjectedManifests', () => {
    it('returns base unchanged when no injection and no filter triggers', () => {
      const toolsDetailed = makeToolsDetailed([OTHER_MANIFEST]);

      const result = composeEnabledTools({
        context: {},
        toolsDetailed,
      });

      expect(result.enabledToolIds).toEqual(['lobe-agent-documents']);
      expect(result.enabledManifests).toEqual([OTHER_MANIFEST]);
      expect(result.tools).toEqual(toolsDetailed.tools);
    });

    it('dedupes injected manifests by identifier', () => {
      const duplicate = makeManifest('lobe-agent-documents', 'replaceDocumentContent');

      const result = composeEnabledTools({
        context: {},
        injectedManifests: [duplicate],
        toolsDetailed: makeToolsDetailed([OTHER_MANIFEST]),
      });

      expect(result.enabledToolIds).toEqual(['lobe-agent-documents']);
      expect(result.enabledManifests).toEqual([OTHER_MANIFEST]);
      expect(result.tools?.some((t) => t.function?.name?.includes('replaceDocumentContent'))).toBe(
        false,
      );
    });

    it('appends new injected manifest and adds its tools', () => {
      const extra = makeManifest('lobe-calculator', 'calc');

      const result = composeEnabledTools({
        context: {},
        injectedManifests: [extra],
        toolsDetailed: makeToolsDetailed([OTHER_MANIFEST]),
      });

      expect(result.enabledToolIds).toEqual(['lobe-agent-documents', 'lobe-calculator']);
      expect(result.enabledManifests).toEqual([OTHER_MANIFEST, extra]);
      expect(result.tools?.some((t) => t.function?.name?.startsWith('lobe-calculator____'))).toBe(
        true,
      );
    });

    it('produces a tools array when base has none but injection brings some', () => {
      const extra = makeManifest('lobe-calculator', 'calc');

      const result = composeEnabledTools({
        context: {},
        injectedManifests: [extra],
        toolsDetailed: makeToolsDetailed([]),
      });

      expect(result.enabledToolIds).toEqual(['lobe-calculator']);
      expect(result.tools).toBeDefined();
      expect(result.tools).toHaveLength(1);
    });
  });

  describe('dropPageAgentIfEditorNotMounted', () => {
    it('keeps PageAgent when scope is not page', () => {
      const result = composeEnabledTools({
        context: { isPageEditorReady: false, scope: undefined },
        toolsDetailed: makeToolsDetailed([PAGE_AGENT_MANIFEST, OTHER_MANIFEST]),
      });

      expect(result.enabledToolIds).toContain(PageAgentIdentifier);
    });

    it('keeps PageAgent when scope is page and editor is ready', () => {
      const result = composeEnabledTools({
        context: { isPageEditorReady: true, scope: 'page' },
        toolsDetailed: makeToolsDetailed([PAGE_AGENT_MANIFEST, OTHER_MANIFEST]),
      });

      expect(result.enabledToolIds).toContain(PageAgentIdentifier);
      expect(result.enabledManifests).toContainEqual(PAGE_AGENT_MANIFEST);
      expect(
        result.tools?.some((t) => t.function?.name?.startsWith(`${PageAgentIdentifier}____`)),
      ).toBe(true);
    });

    it('drops PageAgent from all three outputs when scope is page and editor is not ready', () => {
      const toolsDetailed = makeToolsDetailed([PAGE_AGENT_MANIFEST, OTHER_MANIFEST]);

      const result = composeEnabledTools({
        context: { isPageEditorReady: false, scope: 'page' },
        toolsDetailed,
      });

      expect(result.enabledToolIds).toEqual(['lobe-agent-documents']);
      expect(result.enabledManifests).toEqual([OTHER_MANIFEST]);
      expect(
        result.tools?.every((t) => !t.function?.name?.startsWith(`${PageAgentIdentifier}____`)),
      ).toBe(true);
      expect(result.tools).toHaveLength(1);
    });

    it('sets tools to undefined when dropping PageAgent leaves no tools', () => {
      const result = composeEnabledTools({
        context: { isPageEditorReady: false, scope: 'page' },
        toolsDetailed: makeToolsDetailed([PAGE_AGENT_MANIFEST]),
      });

      expect(result.enabledToolIds).toEqual([]);
      expect(result.enabledManifests).toEqual([]);
      expect(result.tools).toBeUndefined();
    });

    it('is a no-op when scope is page but PageAgent is not enabled', () => {
      const toolsDetailed = makeToolsDetailed([OTHER_MANIFEST]);

      const result = composeEnabledTools({
        context: { isPageEditorReady: false, scope: 'page' },
        toolsDetailed,
      });

      expect(result.enabledToolIds).toEqual(['lobe-agent-documents']);
      expect(result.enabledManifests).toEqual([OTHER_MANIFEST]);
      expect(result.tools).toEqual(toolsDetailed.tools);
    });
  });

  describe('dropSubAgentInGroup', () => {
    it.each(['group', 'group_agent'])(
      'drops only callSubAgent (keeping plan/todo + manifest) when scope is %s',
      (scope) => {
        const result = composeEnabledTools({
          context: { scope },
          toolsDetailed: makeToolsDetailed([LOBE_AGENT_MANIFEST]),
        });

        // manifest and toolId are preserved — the rest of lobe-agent stays usable
        expect(result.enabledToolIds).toContain(LobeAgentIdentifier);
        expect(result.enabledManifests).toContainEqual(LOBE_AGENT_MANIFEST);

        // only callSubAgent is removed from the schema sent to the LLM
        expect(result.tools?.some((t) => t.function?.name === subAgentToolName)).toBe(false);
        expect(
          result.tools?.some(
            (t) => t.function?.name === `${LobeAgentIdentifier}____${LobeAgentApiName.createPlan}`,
          ),
        ).toBe(true);
        expect(
          result.tools?.some(
            (t) => t.function?.name === `${LobeAgentIdentifier}____${LobeAgentApiName.createTodos}`,
          ),
        ).toBe(true);
      },
    );

    it('keeps callSubAgent outside group scopes', () => {
      const result = composeEnabledTools({
        context: { scope: 'main' },
        toolsDetailed: makeToolsDetailed([LOBE_AGENT_MANIFEST]),
      });

      expect(result.tools?.some((t) => t.function?.name === subAgentToolName)).toBe(true);
    });

    it('is a no-op in group scope when lobe-agent is not enabled', () => {
      const toolsDetailed = makeToolsDetailed([OTHER_MANIFEST]);

      const result = composeEnabledTools({
        context: { scope: 'group' },
        toolsDetailed,
      });

      expect(result.tools).toEqual(toolsDetailed.tools);
    });
  });
});
