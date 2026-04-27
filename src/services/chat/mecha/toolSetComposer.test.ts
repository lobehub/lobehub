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

const PAGE_AGENT_MANIFEST = makeManifest(PageAgentIdentifier, 'initPage');
const OTHER_MANIFEST = makeManifest('lobe-agent-documents', 'readDocument');

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
      const duplicate = makeManifest('lobe-agent-documents', 'editDocument');

      const result = composeEnabledTools({
        context: {},
        injectedManifests: [duplicate],
        toolsDetailed: makeToolsDetailed([OTHER_MANIFEST]),
      });

      expect(result.enabledToolIds).toEqual(['lobe-agent-documents']);
      expect(result.enabledManifests).toEqual([OTHER_MANIFEST]);
      expect(result.tools?.some((t) => t.function?.name?.includes('editDocument'))).toBe(false);
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
});
