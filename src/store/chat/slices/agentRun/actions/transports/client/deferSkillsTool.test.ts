import { AgentRuntime } from '@lobechat/agent-runtime';
import {
  getSystemPrompt as getActivatorSystemPrompt,
  LobeActivatorIdentifier,
  LobeActivatorManifest,
} from '@lobechat/builtin-tool-activator';
import { SkillsApiName, SkillsIdentifier, SkillsManifest } from '@lobechat/builtin-tool-skills';
import { generateToolsFromManifest, type LobeToolManifest } from '@lobechat/context-engine';
import type { UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_AGENT_CONFIG } from '@/const/settings';
import type { ResolvedAgentConfig } from '@/services/chat/mecha';
import { resolveClientRunHasSkills } from '@/services/chat/mecha/skillEngineering';

import { deferClientSkillsTool } from './deferSkillsTool';

vi.mock('@/services/chat/mecha/skillEngineering', () => ({
  resolveClientRunHasSkills: vi.fn(),
}));

const webBrowsingManifest: LobeToolManifest = {
  api: [{ description: 'Search the web', name: 'search', parameters: {} }],
  identifier: 'lobe-web-browsing',
  meta: { description: 'Web search', title: 'Web Browsing' },
  type: 'builtin',
};

const userTurn = { content: 'Hello', id: 'u-1', role: 'user' } as UIChatMessage;
const skillsTool = (apiName: string) => `${SkillsIdentifier}____${apiName}`;
const skillsToolNames = (tools: { function: { name: string } }[] = []) =>
  tools.map((tool) => tool.function.name).filter((name) => name.startsWith(SkillsIdentifier));

const buildRun = (chatConfig: Partial<ResolvedAgentConfig['chatConfig']> = {}) => {
  const enabledManifests = [
    LobeActivatorManifest,
    SkillsManifest,
    webBrowsingManifest,
  ] as LobeToolManifest[];
  const enabledToolIds = enabledManifests.map((manifest) => manifest.identifier);
  const tools = enabledManifests.flatMap((manifest) => generateToolsFromManifest(manifest));
  const agentConfig: ResolvedAgentConfig = {
    agentConfig: { ...DEFAULT_AGENT_CONFIG, model: 'test-model', provider: 'test-provider' },
    chatConfig: { ...DEFAULT_AGENT_CHAT_CONFIG, ...chatConfig },
    enabledManifests,
    enabledToolIds,
    isBuiltinAgent: false,
    plugins: [],
    tools,
  };
  const state = AgentRuntime.createInitialState({
    messages: [userTurn],
    operationId: 'operation-1',
    operationToolSet: {
      enabledToolIds: [...enabledToolIds],
      // Wider than the prompt set: it also holds what the activator can discover.
      manifestMap: {
        ...Object.fromEntries(enabledManifests.map((manifest) => [manifest.identifier, manifest])),
        'lobe-skill-store': { ...webBrowsingManifest, identifier: 'lobe-skill-store' },
      },
      sourceMap: {},
      tools: [...tools],
    },
  });

  return { agentConfig, state };
};

describe('deferClientSkillsTool', () => {
  beforeEach(() => {
    vi.mocked(resolveClientRunHasSkills).mockReset();
  });

  it('keeps the sandbox shell and defers the skill APIs when the run has no skills', async () => {
    vi.mocked(resolveClientRunHasSkills).mockResolvedValue(false);
    const run = buildRun();

    const deferred = await deferClientSkillsTool(run, { messages: [userTurn] });

    const shellTools = [skillsTool(SkillsApiName.runCommand), skillsTool(SkillsApiName.exportFile)];
    expect(deferred.agentConfig.enabledToolIds).toContain(SkillsIdentifier);
    expect(skillsToolNames(deferred.agentConfig.tools)).toEqual(shellTools);
    expect(skillsToolNames(deferred.state.operationToolSet!.tools)).toEqual(shellTools);

    const promptManifest = deferred.agentConfig.enabledManifests!.find(
      (manifest) => manifest.identifier === SkillsIdentifier,
    )!;
    expect(promptManifest.api.map((api) => api.name)).toEqual([
      SkillsApiName.runCommand,
      SkillsApiName.exportFile,
    ]);
    expect(promptManifest.systemRole).not.toContain('activateSkill');
    expect(deferred.state.operationToolSet!.manifestMap[SkillsIdentifier]).toBe(promptManifest);

    // The full manifest waits for a mid-run skill install.
    expect(deferred.state.operationToolSet!.deferredManifestMap).toEqual({
      [SkillsIdentifier]: SkillsManifest,
    });
    // Discoverable tools stay in the state's map.
    expect(deferred.state.operationToolSet!.manifestMap['lobe-skill-store']).toBeDefined();

    const activator = deferred.agentConfig.enabledManifests!.find(
      (manifest) => manifest.identifier === LobeActivatorIdentifier,
    )!;
    expect(activator.systemRole).toBe(getActivatorSystemPrompt({ withSkills: false }));

    // The run it was given is not mutated.
    expect(skillsToolNames(run.agentConfig.tools)).toHaveLength(SkillsManifest.api.length);
    expect(run.state.operationToolSet!.deferredManifestMap).toBeUndefined();
  });

  it.each([
    ['has skills', true],
    ['could not confirm its skill list', undefined],
  ])('returns the run untouched when it %s', async (_, hasSkills) => {
    vi.mocked(resolveClientRunHasSkills).mockResolvedValue(hasSkills);
    const run = buildRun();

    await expect(deferClientSkillsTool(run, { messages: [userTurn] })).resolves.toBe(run);
  });

  it('skips the skill lookup for a run that cannot defer', async () => {
    const usedSkills = {
      content: 'ok',
      id: 't-1',
      plugin: { apiName: SkillsApiName.execScript, identifier: SkillsIdentifier },
      role: 'tool',
    } as unknown as UIChatMessage;

    const custom = buildRun({ toolMode: 'custom' });
    await expect(deferClientSkillsTool(custom, { messages: [userTurn] })).resolves.toBe(custom);

    const history = buildRun();
    await expect(
      deferClientSkillsTool(history, { messages: [userTurn, usedSkills] }),
    ).resolves.toBe(history);

    const broadcast = buildRun();
    await expect(
      deferClientSkillsTool(broadcast, { disableTools: true, messages: [userTurn] }),
    ).resolves.toBe(broadcast);

    expect(resolveClientRunHasSkills).not.toHaveBeenCalled();
  });

  describe('a resumed run', () => {
    it('keeps the full tool when the run did not defer at start', async () => {
      const run = buildRun();

      await expect(
        deferClientSkillsTool(run, { messages: [userTurn], resumed: true }),
      ).resolves.toBe(run);
      expect(resolveClientRunHasSkills).not.toHaveBeenCalled();
    });

    // The agent config is rebuilt in full on every resume; a run that started
    // deferred must not get the skill APIs back just because it was approved.
    it('narrows the rebuilt agent config again when the run started deferred', async () => {
      vi.mocked(resolveClientRunHasSkills).mockResolvedValue(false);
      const started = await deferClientSkillsTool(buildRun(), { messages: [userTurn] });
      const rebuilt = { agentConfig: buildRun().agentConfig, state: started.state };
      vi.mocked(resolveClientRunHasSkills).mockClear();

      const resumed = await deferClientSkillsTool(rebuilt, {
        messages: [userTurn],
        resumed: true,
      });

      expect(skillsToolNames(resumed.agentConfig.tools)).toEqual([
        skillsTool(SkillsApiName.runCommand),
        skillsTool(SkillsApiName.exportFile),
      ]);
      // The state already carries the narrowed set and the deferred manifest.
      expect(resumed.state).toBe(started.state);
      expect(resolveClientRunHasSkills).not.toHaveBeenCalled();
    });
  });
});
