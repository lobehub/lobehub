import {
  getSystemPrompt as getActivatorSystemPrompt,
  getSystemPromptForShareVisitor as getActivatorSystemPromptForShareVisitor,
  LobeActivatorIdentifier,
  LobeActivatorManifest,
} from '@lobechat/builtin-tool-activator';
import {
  resolveSkillsManifest,
  SkillsApiName,
  SkillsIdentifier,
  SkillsManifest,
} from '@lobechat/builtin-tool-skills';
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

type ToolSet = DeferUnusedSkillsToolParams['toolSet'] & {
  enabledToolIds: string[];
  tools: UniformTool[];
};

const buildToolSet = (
  skillsManifest: LobeToolManifest = { ...SkillsManifest } as LobeToolManifest,
): ToolSet => {
  const manifestMap: Record<string, LobeToolManifest> = {
    [LobeActivatorIdentifier]: { ...LobeActivatorManifest },
    [SkillsIdentifier]: skillsManifest,
    'lobe-skill-store': { ...skillStoreManifest },
    'lobe-web-browsing': { ...webBrowsingManifest },
  };

  return {
    activatableToolIds: [],
    enabledToolIds: [LobeActivatorIdentifier, SkillsIdentifier, 'lobe-web-browsing'],
    executorMap: {},
    manifestMap,
    sourceMap: {
      [LobeActivatorIdentifier]: 'builtin',
      [SkillsIdentifier]: 'builtin',
      'lobe-skill-store': 'builtin',
      'lobe-web-browsing': 'builtin',
    },
    tools: [
      ...generateToolsFromManifest(manifestMap[LobeActivatorIdentifier]),
      ...generateToolsFromManifest(manifestMap[SkillsIdentifier]),
      ...generateToolsFromManifest(manifestMap['lobe-web-browsing']),
    ],
  };
};

const buildParams = (
  overrides: Partial<DeferUnusedSkillsToolParams> = {},
): DeferUnusedSkillsToolParams & { toolSet: ToolSet } => ({
  agentChatConfig: {},
  allMessages: [{ content: 'Hello', id: 'u-1', role: 'user' } as UIChatMessage],
  operationSkillSet: { enabledSkillIds: [], skills: [] },
  toolSet: buildToolSet(),
  ...overrides,
});

const skillsToolNames = (toolSet: ToolSet) =>
  toolSet.tools
    .map((tool) => tool.function.name)
    .filter((name) => name.startsWith(`${SkillsIdentifier}____`));

const skillsTool = (apiName: string) => `${SkillsIdentifier}____${apiName}`;

const expectUntouched = (params: DeferUnusedSkillsToolParams & { toolSet: ToolSet }) => {
  expect(deferUnusedSkillsTool(params)).toBe(false);
  expect(params.toolSet.enabledToolIds).toContain(SkillsIdentifier);
  expect(params.toolSet.manifestMap[SkillsIdentifier].api).toHaveLength(SkillsManifest.api.length);
  expect(skillsToolNames(params.toolSet)).toHaveLength(SkillsManifest.api.length);
  expect(params.toolSet.deferredManifestMap).toBeUndefined();
};

describe('deferUnusedSkillsTool', () => {
  it('keeps the sandbox shell and exportFile while deferring the skill APIs', () => {
    const params = buildParams();
    const { toolSet } = params;
    const fullManifest = toolSet.manifestMap[SkillsIdentifier];

    expect(deferUnusedSkillsTool(params)).toBe(true);

    // The always-on shell is still enabled and callable.
    expect(toolSet.enabledToolIds).toEqual([
      LobeActivatorIdentifier,
      SkillsIdentifier,
      'lobe-web-browsing',
    ]);
    expect(skillsToolNames(toolSet)).toEqual([
      skillsTool(SkillsApiName.runCommand),
      skillsTool(SkillsApiName.exportFile),
    ]);
    expect(toolSet.manifestMap[SkillsIdentifier].api.map((api) => api.name)).toEqual([
      SkillsApiName.runCommand,
      SkillsApiName.exportFile,
    ]);
    expect(toolSet.manifestMap[SkillsIdentifier].systemRole).toContain('{{sandbox_workspace}}');
    expect(toolSet.manifestMap[SkillsIdentifier].systemRole).not.toContain('activateSkill');

    // The full manifest waits for a mid-run skill install.
    expect(toolSet.deferredManifestMap).toEqual({ [SkillsIdentifier]: fullManifest });

    // Other tools are untouched.
    expect(toolSet.tools.some((t) => t.function.name.startsWith('lobe-web-browsing____'))).toBe(
      true,
    );

    // The activator stops pointing at `activateSkill` but keeps skill store discovery.
    const activatorRole = toolSet.manifestMap[LobeActivatorIdentifier].systemRole;
    expect(activatorRole).toBe(getActivatorSystemPrompt({ withSkills: false }));
    expect(activatorRole).toContain('<skill_store_discovery>');
    expect(activatorRole).not.toContain('activateSkill');
  });

  it('removes the tool entirely on a routed device, where it offers no sandbox shell', () => {
    const deviceManifest = resolveSkillsManifest({ executionEnv: 'device' }) as LobeToolManifest;
    const params = buildParams({ toolSet: buildToolSet(deviceManifest) });
    const { toolSet } = params;

    expect(deferUnusedSkillsTool(params)).toBe(true);

    expect(toolSet.enabledToolIds).toEqual([LobeActivatorIdentifier, 'lobe-web-browsing']);
    expect(skillsToolNames(toolSet)).toEqual([]);
    // Out of `manifestMap`, so the activator never lists it in <available_tools>.
    expect(toolSet.manifestMap[SkillsIdentifier]).toBeUndefined();
    expect(toolSet.deferredManifestMap).toEqual({ [SkillsIdentifier]: deviceManifest });
    // Routing stays in place for the promotion.
    expect(toolSet.sourceMap[SkillsIdentifier]).toBe('builtin');
  });

  it('leaves the tool alone when at least one skill is available', () => {
    expectUntouched(
      buildParams({
        operationSkillSet: {
          enabledSkillIds: ['lobehub'],
          skills: [{ description: 'CLI', identifier: 'lobehub', name: 'LobeHub' }],
        },
      }),
    );
  });

  it('leaves the tool alone when the skill set could not be built', () => {
    expectUntouched(buildParams({ operationSkillSet: undefined }));
  });

  it('does nothing when the tools engine reported no enabled tool ids', () => {
    const params = buildParams();
    const toolSet = { ...params.toolSet, enabledToolIds: undefined };

    expect(deferUnusedSkillsTool({ ...params, toolSet })).toBe(false);
    expect(toolSet.deferredManifestMap).toBeUndefined();
  });

  it('leaves the tool alone when history already called lobe-skills', () => {
    expectUntouched(
      buildParams({
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
      }),
    );
  });

  it('still defers the skill APIs after earlier turns used the sandbox shell', () => {
    const params = buildParams({
      allMessages: [
        {
          content: 'done',
          id: 't-1',
          plugin: { apiName: SkillsApiName.runCommand, identifier: SkillsIdentifier },
          role: 'tool',
        } as unknown as UIChatMessage,
        { content: 'Run another', id: 'u-2', role: 'user' } as UIChatMessage,
      ],
    });

    expect(deferUnusedSkillsTool(params)).toBe(true);
    expect(skillsToolNames(params.toolSet)).toEqual([
      skillsTool(SkillsApiName.runCommand),
      skillsTool(SkillsApiName.exportFile),
    ]);
  });

  it('leaves the tool alone when history has grouped lobe-skills tool calls', () => {
    expectUntouched(
      buildParams({
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
      }),
    );
  });

  it('leaves the tool alone when a skill was loaded through the activator fallback', () => {
    expectUntouched(
      buildParams({
        allMessages: [
          {
            content: 'Skill loaded',
            id: 't-1',
            plugin: { apiName: 'activateTools', identifier: LobeActivatorIdentifier },
            pluginState: { activatedSkills: [{ id: 'skl_1', name: 'pptx' }], activatedTools: [] },
            role: 'tool',
          } as unknown as UIChatMessage,
          { content: 'Now read its reference', id: 'u-2', role: 'user' } as UIChatMessage,
        ],
      }),
    );
  });

  it('leaves the tool alone in custom mode, goal turns, exclusivePluginIds, or evalAllowedTools', () => {
    expectUntouched(buildParams({ agentChatConfig: { toolMode: 'custom' } }));
    expectUntouched(buildParams({ isGoalTurn: true }));
    expectUntouched(buildParams({ exclusivePluginIds: [SkillsIdentifier] }));
    expectUntouched(buildParams({ evalAllowedTools: [skillsTool(SkillsApiName.activateSkill)] }));
  });

  it('drops lobe-skills completely on share runs with 0 surviving skills and updates activator', () => {
    const params = buildParams({ isShareRun: true });
    const { toolSet } = params;
    toolSet.manifestMap[LobeActivatorIdentifier] = {
      ...LobeActivatorManifest,
      systemRole: getActivatorSystemPromptForShareVisitor({ withSkills: true }),
    };

    expect(deferUnusedSkillsTool(params)).toBe(true);
    expect(toolSet.enabledToolIds).not.toContain(SkillsIdentifier);
    expect(skillsToolNames(toolSet)).toEqual([]);
    expect(toolSet.manifestMap[SkillsIdentifier]).toBeUndefined();
    expect(toolSet.sourceMap[SkillsIdentifier]).toBeUndefined();
    // A visitor cannot install skills, so nothing is kept for later.
    expect(toolSet.deferredManifestMap).toBeUndefined();
    expect(toolSet.manifestMap[LobeActivatorIdentifier].systemRole).toBe(
      getActivatorSystemPromptForShareVisitor({ withSkills: false }),
    );
  });

  it('also drops lobe-activator on share runs when no other activatable tools remain', () => {
    const params = buildParams({ isShareRun: true });
    const { toolSet } = params;
    delete toolSet.manifestMap['lobe-skill-store'];

    expect(deferUnusedSkillsTool(params)).toBe(true);
    expect(toolSet.manifestMap[SkillsIdentifier]).toBeUndefined();
    expect(toolSet.manifestMap[LobeActivatorIdentifier]).toBeUndefined();
    expect(toolSet.enabledToolIds).not.toContain(LobeActivatorIdentifier);
  });
});
