import {
  getSystemPrompt as getActivatorSystemPrompt,
  getSystemPromptForShareVisitor as getActivatorSystemPromptForShareVisitor,
  LobeActivatorIdentifier,
  LobeActivatorManifest,
} from '@lobechat/builtin-tool-activator';
import { SkillsIdentifier, SkillsManifest } from '@lobechat/builtin-tool-skills';
import {
  generateToolsFromManifest,
  type LobeToolManifest,
  type UniformTool,
} from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { deferUnusedSkillsTool, type DeferUnusedSkillsToolParams } from './deferUnusedSkillsTool';

const webBrowsingManifest: LobeToolManifest = {
  api: [{ description: 'Search the web', name: 'search', parameters: {} }],
  identifier: 'lobe-web-browsing',
  meta: { description: 'Web search', title: 'Web Browsing' },
  type: 'builtin',
};

const skillStoreManifest: LobeToolManifest = {
  api: [{ description: 'Import a skill', name: 'importFromMarket', parameters: {} }],
  identifier: 'lobe-skill-store',
  meta: { description: 'Skill Store', title: 'Skill Store' },
  type: 'builtin',
};

const buildParams = (
  overrides: Partial<DeferUnusedSkillsToolParams> = {},
): DeferUnusedSkillsToolParams => {
  const manifestMap: Record<string, LobeToolManifest> = {
    [LobeActivatorIdentifier]: { ...LobeActivatorManifest },
    [SkillsIdentifier]: { ...SkillsManifest },
    'lobe-skill-store': { ...skillStoreManifest },
    'lobe-web-browsing': { ...webBrowsingManifest },
  };
  const tools: UniformTool[] = [
    ...generateToolsFromManifest(manifestMap[LobeActivatorIdentifier]),
    ...generateToolsFromManifest(manifestMap[SkillsIdentifier]),
    ...generateToolsFromManifest(manifestMap['lobe-web-browsing']),
  ];

  return {
    activatableToolIds: [],
    agentChatConfig: {},
    allMessages: [{ content: 'Hello', id: 'u-1', role: 'user' } as UIChatMessage],
    enabledToolIds: [LobeActivatorIdentifier, SkillsIdentifier, 'lobe-web-browsing'],
    executorMap: {},
    manifestMap,
    operationSkillSet: { enabledSkillIds: [], skills: [] },
    sourceMap: {
      [LobeActivatorIdentifier]: 'builtin',
      [SkillsIdentifier]: 'builtin',
      'lobe-skill-store': 'builtin',
      'lobe-web-browsing': 'builtin',
    },
    tools,
    ...overrides,
  };
};

describe('deferUnusedSkillsTool', () => {
  it('defers lobe-skills when 0 skills are available while keeping its manifest for mid-run activation', () => {
    const params = buildParams();

    const deferred = deferUnusedSkillsTool(params);

    expect(deferred).toBe(true);
    expect(params.enabledToolIds).not.toContain(SkillsIdentifier);
    expect(params.enabledToolIds).toEqual([LobeActivatorIdentifier, 'lobe-web-browsing']);
    expect(params.tools?.some((t) => t.function.name.startsWith(`${SkillsIdentifier}____`))).toBe(
      false,
    );
    expect(params.tools?.some((t) => t.function.name.startsWith('lobe-web-browsing____'))).toBe(
      true,
    );
    // Manifest stays in the pool so mid-run `lobe-skill-store` install can activate it
    expect(params.manifestMap[SkillsIdentifier]).toBeDefined();
    expect(params.sourceMap[SkillsIdentifier]).toBe('builtin');
    // Activator systemRole drops the activateSkill guideline while keeping skill store discovery
    expect(params.manifestMap[LobeActivatorIdentifier].systemRole).toBe(
      getActivatorSystemPrompt({ withSkills: false }),
    );
    expect(params.manifestMap[LobeActivatorIdentifier].systemRole).toContain(
      '<skill_store_discovery>',
    );
    expect(params.manifestMap[LobeActivatorIdentifier].systemRole).not.toContain('activateSkill');
  });

  it('keeps lobe-skills enabled when at least one skill is available', () => {
    const params = buildParams({
      operationSkillSet: {
        enabledSkillIds: ['lobehub'],
        skills: [{ description: 'CLI', identifier: 'lobehub', name: 'LobeHub' }],
      },
    });

    expect(deferUnusedSkillsTool(params)).toBe(false);
    expect(params.enabledToolIds).toContain(SkillsIdentifier);
    expect(params.tools?.some((t) => t.function.name.startsWith(`${SkillsIdentifier}____`))).toBe(
      true,
    );
  });

  it('keeps lobe-skills enabled when conversation history already called lobe-skills', () => {
    const params = buildParams({
      allMessages: [
        { content: 'Run my skill', id: 'u-1', role: 'user' } as UIChatMessage,
        {
          content: 'Loaded',
          id: 't-1',
          plugin: { apiName: 'activateSkill', identifier: SkillsIdentifier },
          role: 'tool',
        } as unknown as UIChatMessage,
        { content: 'Continue', id: 'u-2', role: 'user' } as UIChatMessage,
      ],
    });

    expect(deferUnusedSkillsTool(params)).toBe(false);
    expect(params.enabledToolIds).toContain(SkillsIdentifier);
  });

  it('keeps lobe-skills enabled when history contains grouped assistantGroup lobe-skills tool calls', () => {
    const params = buildParams({
      allMessages: [
        {
          children: [
            {
              tools: [{ apiName: 'execScript', id: 'call_1', identifier: SkillsIdentifier }],
            },
          ],
          content: '',
          id: 'grp-1',
          role: 'assistantGroup',
        } as unknown as UIChatMessage,
      ],
    });

    expect(deferUnusedSkillsTool(params)).toBe(false);
    expect(params.enabledToolIds).toContain(SkillsIdentifier);
  });

  it('keeps lobe-skills enabled in custom mode, goal turns, exclusivePluginIds, or evalAllowedTools', () => {
    const customMode = buildParams({ agentChatConfig: { toolMode: 'custom' } });
    expect(deferUnusedSkillsTool(customMode)).toBe(false);
    expect(customMode.enabledToolIds).toContain(SkillsIdentifier);

    const goalTurn = buildParams({ isGoalTurn: true });
    expect(deferUnusedSkillsTool(goalTurn)).toBe(false);
    expect(goalTurn.enabledToolIds).toContain(SkillsIdentifier);

    const exclusive = buildParams({ exclusivePluginIds: [SkillsIdentifier] });
    expect(deferUnusedSkillsTool(exclusive)).toBe(false);
    expect(exclusive.enabledToolIds).toContain(SkillsIdentifier);

    const evalAllowed = buildParams({ evalAllowedTools: [`${SkillsIdentifier}____activateSkill`] });
    expect(deferUnusedSkillsTool(evalAllowed)).toBe(false);
    expect(evalAllowed.enabledToolIds).toContain(SkillsIdentifier);
  });

  it('drops lobe-skills completely on share runs with 0 surviving skills and updates activator', () => {
    const params = buildParams({ isShareRun: true });
    params.manifestMap[LobeActivatorIdentifier] = {
      ...LobeActivatorManifest,
      systemRole: getActivatorSystemPromptForShareVisitor({ withSkills: true }),
    };

    expect(deferUnusedSkillsTool(params)).toBe(true);
    expect(params.enabledToolIds).not.toContain(SkillsIdentifier);
    expect(params.manifestMap[SkillsIdentifier]).toBeUndefined();
    expect(params.sourceMap[SkillsIdentifier]).toBeUndefined();
    expect(params.manifestMap[LobeActivatorIdentifier].systemRole).toBe(
      getActivatorSystemPromptForShareVisitor({ withSkills: false }),
    );
  });

  it('also drops lobe-activator on share runs when no other activatable tools remain', () => {
    const params = buildParams({ isShareRun: true });
    delete params.manifestMap['lobe-skill-store'];

    expect(deferUnusedSkillsTool(params)).toBe(true);
    expect(params.manifestMap[SkillsIdentifier]).toBeUndefined();
    expect(params.manifestMap[LobeActivatorIdentifier]).toBeUndefined();
    expect(params.enabledToolIds).not.toContain(LobeActivatorIdentifier);
  });
});
