import {
  getSystemPrompt as getActivatorSystemPrompt,
  LobeActivatorIdentifier,
  LobeActivatorManifest,
} from '@lobechat/builtin-tool-activator';
import {
  resolveSkillsManifest,
  SkillsApiName,
  SkillsIdentifier,
  SkillsManifest,
} from '@lobechat/builtin-tool-skills';
import { generateToolsFromManifest, type LobeToolManifest } from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  applySkillsToolDeferral,
  canDeferSkillsTool,
  planSkillsToolDeferral,
} from './deferSkillsTool';

const userTurn = { content: 'Hello', id: 'u-1', role: 'user' } as UIChatMessage;
const skillsTool = (apiName: string) => `${SkillsIdentifier}____${apiName}`;

const buildToolSet = (skillsManifest = SkillsManifest as LobeToolManifest) => {
  const manifestMap: Record<string, LobeToolManifest> = {
    [LobeActivatorIdentifier]: { ...LobeActivatorManifest },
    [SkillsIdentifier]: skillsManifest,
  };

  return {
    enabledToolIds: [LobeActivatorIdentifier, SkillsIdentifier],
    manifestMap,
    tools: Object.values(manifestMap).flatMap((manifest) => generateToolsFromManifest(manifest)),
  };
};

describe('canDeferSkillsTool', () => {
  it('defers only an Agent-mode run known to have no skills', () => {
    expect(canDeferSkillsTool({ hasSkills: false, messages: [userTurn] })).toBe(true);
    expect(canDeferSkillsTool({ hasSkills: true, messages: [userTurn] })).toBe(false);
    // The host could not establish the skill list.
    expect(canDeferSkillsTool({ hasSkills: undefined, messages: [userTurn] })).toBe(false);
    expect(
      canDeferSkillsTool({
        chatConfig: { toolMode: 'custom' },
        hasSkills: false,
        messages: [userTurn],
      }),
    ).toBe(false);
  });

  const toolRow = (apiName: string) =>
    ({
      content: 'ok',
      id: `t-${apiName}`,
      plugin: { apiName, identifier: SkillsIdentifier },
      role: 'tool',
    }) as unknown as UIChatMessage;

  it('does not defer once the conversation called a skill API', () => {
    expect(
      canDeferSkillsTool({
        hasSkills: false,
        messages: [userTurn, toolRow(SkillsApiName.readReference)],
      }),
    ).toBe(false);
  });

  // The shell stays declared either way, so using it must not bring the skill
  // APIs back for the rest of the conversation.
  it('still defers after the conversation used the sandbox shell', () => {
    expect(
      canDeferSkillsTool({
        hasSkills: false,
        messages: [userTurn, toolRow(SkillsApiName.runCommand), toolRow(SkillsApiName.exportFile)],
      }),
    ).toBe(true);
  });

  it('does not defer once a skill was loaded through the activator', () => {
    const activation = {
      content: 'Skill loaded',
      id: 't-1',
      plugin: { apiName: 'activateTools', identifier: LobeActivatorIdentifier },
      pluginState: { activatedSkills: [{ name: 'pptx' }], activatedTools: [] },
      role: 'tool',
    } as unknown as UIChatMessage;

    expect(canDeferSkillsTool({ hasSkills: false, messages: [userTurn, activation] })).toBe(false);
  });
});

describe('planSkillsToolDeferral', () => {
  it('keeps the sandbox shell and removes the tools of the skill APIs', () => {
    const { manifestMap } = buildToolSet();
    const deferral = planSkillsToolDeferral(manifestMap)!;

    expect(deferral.fullManifest).toBe(manifestMap[SkillsIdentifier]);
    expect(deferral.shellManifest?.api.map(({ name }) => name)).toEqual([
      SkillsApiName.runCommand,
      SkillsApiName.exportFile,
    ]);
    expect([...deferral.removedToolNames].sort()).toEqual(
      [
        skillsTool(SkillsApiName.activateSkill),
        skillsTool(SkillsApiName.execScript),
        skillsTool(SkillsApiName.readReference),
      ].sort(),
    );
    expect(deferral.activatorManifest?.systemRole).toBe(
      getActivatorSystemPrompt({ withSkills: false }),
    );
  });

  it('has no shell to keep on a routed device', () => {
    const { manifestMap } = buildToolSet(
      resolveSkillsManifest({ executionEnv: 'device' }) as LobeToolManifest,
    );
    const deferral = planSkillsToolDeferral(manifestMap)!;

    expect(deferral.shellManifest).toBeUndefined();
    expect(deferral.removedToolNames.size).toBe(manifestMap[SkillsIdentifier].api.length);
  });

  it('leaves a customised activator role alone', () => {
    const { manifestMap } = buildToolSet();
    manifestMap[LobeActivatorIdentifier] = { ...LobeActivatorManifest, systemRole: 'custom role' };

    expect(planSkillsToolDeferral(manifestMap)?.activatorManifest).toBeUndefined();
  });

  it('returns nothing when the tool is not in the set', () => {
    expect(planSkillsToolDeferral({})).toBeUndefined();
  });
});

describe('applySkillsToolDeferral', () => {
  it('narrows the enabled tool in place and stores the full manifest', () => {
    const toolSet: ReturnType<typeof buildToolSet> & {
      deferredManifestMap?: Record<string, LobeToolManifest>;
    } = buildToolSet();
    const { enabledToolIds, tools } = toolSet;
    const deferral = planSkillsToolDeferral(toolSet.manifestMap)!;

    applySkillsToolDeferral(toolSet, deferral);

    // Same arrays the host already handed out.
    expect(toolSet.enabledToolIds).toBe(enabledToolIds);
    expect(toolSet.tools).toBe(tools);
    expect(enabledToolIds).toEqual([LobeActivatorIdentifier, SkillsIdentifier]);
    expect(
      tools.map((tool) => tool.function.name).filter((name) => name.startsWith(SkillsIdentifier)),
    ).toEqual([skillsTool(SkillsApiName.runCommand), skillsTool(SkillsApiName.exportFile)]);
    expect(toolSet.manifestMap[SkillsIdentifier]).toBe(deferral.shellManifest);
    expect(toolSet.deferredManifestMap).toEqual({ [SkillsIdentifier]: deferral.fullManifest });
  });

  it('takes the tool out of the enabled set when there is no shell to keep', () => {
    const toolSet: ReturnType<typeof buildToolSet> & {
      deferredManifestMap?: Record<string, LobeToolManifest>;
    } = buildToolSet(resolveSkillsManifest({ executionEnv: 'local' }) as LobeToolManifest);
    const deferral = planSkillsToolDeferral(toolSet.manifestMap)!;

    applySkillsToolDeferral(toolSet, deferral);

    expect(toolSet.enabledToolIds).toEqual([LobeActivatorIdentifier]);
    expect(toolSet.manifestMap[SkillsIdentifier]).toBeUndefined();
    expect(toolSet.tools.some((tool) => tool.function.name.startsWith(SkillsIdentifier))).toBe(
      false,
    );
    expect(toolSet.deferredManifestMap?.[SkillsIdentifier]).toBe(deferral.fullManifest);
  });
});
