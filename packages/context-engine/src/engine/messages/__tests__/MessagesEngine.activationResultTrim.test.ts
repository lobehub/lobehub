import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import type { SkillMeta } from '../../../providers/SkillContextProvider';
import type { LobeToolManifest } from '../../tools/types';
import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

/**
 * Regression tests: after dynamic activation, the full tool
 * systemRole / skill content must reach the final LLM payload exactly once —
 * either via the system prompt injection OR via the activation tool result,
 * never both.
 */

const CREDS_SYSTEM_ROLE =
  'lobe-creds usage: always list before creating; never print secret values.\n'.repeat(30);
const SKILL_CONTENT = '# PowerShell\n\nUse pwsh for all Windows automation tasks.\n'.repeat(30);
const RESOURCE_TREE = '<resources skill="PowerShell">\n- scripts/run.ps1\n</resources>';

const credsManifest = {
  api: [{ description: 'List credentials', name: 'listCreds' }],
  identifier: 'lobe-creds',
  meta: { title: 'Creds' },
  systemRole: CREDS_SYSTEM_ROLE,
  type: 'builtin',
} as unknown as LobeToolManifest;

const powershellSkill: SkillMeta = {
  activated: true,
  content: SKILL_CONTENT,
  description: 'Run PowerShell',
  identifier: 'powershell',
  name: 'PowerShell',
};

const now = Date.now();

const activateToolsMessages = (): UIChatMessage[] =>
  [
    { content: 'help me manage creds', createdAt: now, id: 'u1', role: 'user', updatedAt: now },
    {
      content: '',
      createdAt: now,
      id: 'a1',
      role: 'assistant',
      tools: [
        {
          apiName: 'activateTools',
          arguments: '{"identifiers":["lobe-creds"]}',
          id: 'call_activate_1',
          identifier: 'lobe-activator',
          type: 'builtin',
        },
      ],
      updatedAt: now,
    },
    {
      content: `Successfully activated tools:\n\n## Creds (lobe-creds)\n${CREDS_SYSTEM_ROLE}\n\nAvailable APIs:\n- **listCreds**: List credentials`,
      createdAt: now,
      id: 't1',
      plugin: {
        apiName: 'activateTools',
        arguments: '{"identifiers":["lobe-creds"]}',
        identifier: 'lobe-activator',
        type: 'builtin',
      },
      pluginState: {
        activatedSkills: [],
        activatedTools: [{ apiCount: 1, identifier: 'lobe-creds', name: 'Creds' }],
        alreadyActive: [],
        notFound: [],
      },
      role: 'tool',
      tool_call_id: 'call_activate_1',
      updatedAt: now,
    },
    { content: 'now list my creds', createdAt: now, id: 'u2', role: 'user', updatedAt: now },
  ] as unknown as UIChatMessage[];

const activateSkillMessages = (): UIChatMessage[] =>
  [
    { content: 'run a pwsh script', createdAt: now, id: 'u1', role: 'user', updatedAt: now },
    {
      content: '',
      createdAt: now,
      id: 'a1',
      role: 'assistant',
      tools: [
        {
          apiName: 'activateSkill',
          arguments: '{"name":"PowerShell"}',
          id: 'call_skill_1',
          identifier: 'lobe-skills',
          type: 'builtin',
        },
      ],
      updatedAt: now,
    },
    {
      content: `${SKILL_CONTENT}\n\n${RESOURCE_TREE}`,
      createdAt: now,
      id: 't1',
      plugin: {
        apiName: 'activateSkill',
        arguments: '{"name":"PowerShell"}',
        identifier: 'lobe-skills',
        type: 'builtin',
      },
      pluginState: { hasResources: true, name: 'PowerShell', source: 'user' },
      role: 'tool',
      tool_call_id: 'call_skill_1',
      updatedAt: now,
    },
    { content: 'go ahead', createdAt: now, id: 'u2', role: 'user', updatedAt: now },
  ] as unknown as UIChatMessage[];

const createParams = (overrides?: Partial<MessagesEngineParams>): MessagesEngineParams => ({
  capabilities: { isCanUseFC: () => true },
  enableSystemDate: false,
  messages: [],
  model: 'gpt-4',
  provider: 'openai',
  systemRole: 'You are a helpful assistant',
  ...overrides,
});

/** Count how many times `needle` appears across every message content in the payload. */
const countInPayload = (messages: any[], needle: string) => {
  const haystack = messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n<<<message-boundary>>>\n');
  return haystack.split(needle).length - 1;
};

describe('MessagesEngine — activation result trimming', () => {
  describe('activateTools', () => {
    it('should carry an activated manifest systemRole exactly once when injected', async () => {
      const engine = new MessagesEngine(
        createParams({
          messages: activateToolsMessages(),
          toolsConfig: { manifests: [credsManifest], tools: ['lobe-creds'] },
        }),
      );

      const result = await engine.process();

      expect(countInPayload(result.messages, CREDS_SYSTEM_ROLE)).toBe(1);
      // The single copy lives in the system prompt, not the tool result.
      const systemMessage = result.messages.find((m) => m.role === 'system');
      expect(systemMessage?.content).toContain(CREDS_SYSTEM_ROLE);
      const toolMessage = result.messages.find((m) => m.role === 'tool');
      expect(toolMessage?.content).toContain('Successfully activated tools: lobe-creds.listCreds.');
      expect(toolMessage?.content).toContain('in the system prompt');
    });

    it('should keep the tool result as the single channel when the manifest is not injected', async () => {
      const engine = new MessagesEngine(
        createParams({ messages: activateToolsMessages(), toolsConfig: { tools: [] } }),
      );

      const result = await engine.process();

      expect(countInPayload(result.messages, CREDS_SYSTEM_ROLE)).toBe(1);
      const toolMessage = result.messages.find((m) => m.role === 'tool');
      expect(toolMessage?.content).toContain(CREDS_SYSTEM_ROLE);
    });

    it('should not trim when the model does not support function calling', async () => {
      const engine = new MessagesEngine(
        createParams({
          capabilities: { isCanUseFC: () => false },
          messages: activateToolsMessages(),
          toolsConfig: { manifests: [credsManifest], tools: ['lobe-creds'] },
        }),
      );

      const result = await engine.process();

      // No FC → ToolSystemRoleProvider injects nothing → the tool result stays
      // the single carrier of the document.
      expect(countInPayload(result.messages, CREDS_SYSTEM_ROLE)).toBe(1);
    });
  });

  describe('activateSkill', () => {
    it('should carry an activated skill content exactly once when injected', async () => {
      const engine = new MessagesEngine(
        createParams({
          messages: activateSkillMessages(),
          skillsConfig: { enabledSkills: [powershellSkill] },
        }),
      );

      const result = await engine.process();

      expect(countInPayload(result.messages, SKILL_CONTENT)).toBe(1);
      const systemMessage = result.messages.find((m) => m.role === 'system');
      expect(systemMessage?.content).toContain(SKILL_CONTENT);
      const toolMessage = result.messages.find((m) => m.role === 'tool');
      expect(toolMessage?.content).toContain('Skill "PowerShell" activated');
      // The resource tree is NOT part of the injected content — it must survive.
      expect(toolMessage?.content).toContain(RESOURCE_TREE);
    });

    it('should keep the tool result as the single channel for non-injected skills', async () => {
      const engine = new MessagesEngine(
        createParams({
          messages: activateSkillMessages(),
          skillsConfig: {
            enabledSkills: [{ ...powershellSkill, activated: false, content: undefined }],
          },
        }),
      );

      const result = await engine.process();

      expect(countInPayload(result.messages, SKILL_CONTENT)).toBe(1);
      const toolMessage = result.messages.find((m) => m.role === 'tool');
      expect(toolMessage?.content).toContain(SKILL_CONTENT);
    });

    it('should not trim in chat mode where SkillContextProvider is disabled', async () => {
      const engine = new MessagesEngine(
        createParams({
          enableAgentMode: false,
          messages: activateSkillMessages(),
          skillsConfig: { enabledSkills: [powershellSkill] },
        }),
      );

      const result = await engine.process();

      expect(countInPayload(result.messages, SKILL_CONTENT)).toBe(1);
      const toolMessage = result.messages.find((m) => m.role === 'tool');
      expect(toolMessage?.content).toContain(SKILL_CONTENT);
    });
  });

  it('should not trim when a system-replace agent document discards the injections', async () => {
    // AgentDocumentSystemReplaceInjector replaces the whole assembled system
    // message AFTER the providers appended the activation docs — the tool
    // result must stay the single content channel.
    const engine = new MessagesEngine(
      createParams({
        agentDocuments: [
          {
            content: 'You are a totally custom agent.',
            filename: 'persona.md',
            loadPosition: 'system-replace',
          },
        ],
        messages: activateToolsMessages(),
        toolsConfig: { manifests: [credsManifest], tools: ['lobe-creds'] },
      }),
    );

    const result = await engine.process();

    expect(countInPayload(result.messages, CREDS_SYSTEM_ROLE)).toBe(1);
    const toolMessage = result.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.content).toContain(CREDS_SYSTEM_ROLE);
    // The replaced system message carries only the agent document (here folded
    // into the progressive index) — the provider injections are gone.
    const systemMessage = result.messages.find((m) => m.role === 'system');
    expect(systemMessage?.content).not.toContain(CREDS_SYSTEM_ROLE);
    expect(systemMessage?.content).toContain('persona.md');
  });

  it('should stay byte-stable across subsequent requests (prompt-cache friendly)', async () => {
    const params = createParams({
      messages: activateToolsMessages(),
      toolsConfig: { manifests: [credsManifest], tools: ['lobe-creds'] },
    });

    const first = await new MessagesEngine(params).process();
    const second = await new MessagesEngine(params).process();

    expect(second.messages).toEqual(first.messages);
  });
});
