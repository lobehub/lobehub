import { describe, expect, it } from 'vitest';

import type { UIChatMessage } from '@/types/index';

import { MessagesEngine } from '../MessagesEngine';
import type { MessagesEngineParams } from '../types';

const createParams = (tools: string[]): MessagesEngineParams => ({
  messages: [
    {
      content: 'Deploy the project',
      createdAt: 1_700_000_000_000,
      id: 'msg-1',
      role: 'user',
      updatedAt: 1_700_000_000_000,
    } as UIChatMessage,
  ],
  model: 'gemini-4-neon',
  provider: 'lobehub',
  skillsConfig: {
    enabledSkills: [
      {
        description: 'Deploy helper',
        identifier: 'project:deploy',
        location: '/repo/.agents/skills/deploy/SKILL.md',
        name: 'deploy',
        source: 'project',
      },
    ],
  },
  systemRole: 'You are a helpful assistant.',
  toolsConfig: { manifests: [], tools },
});

const systemPromptFor = async (tools: string[]) => {
  const result = await new MessagesEngine(createParams(tools)).process();
  return result.messages[0].content as string;
};

describe('MessagesEngine filesystem skill loading instruction', () => {
  it('routes a filesystem skill through activateSkill when the run was sent Skills', async () => {
    const system = await systemPromptFor(['lobe-skills', 'lobe-local-system']);

    expect(system).toContain('load it with activateSkill by name');
    expect(system).not.toContain('calling the readFile tool');
  });

  it('keeps the readFile route when the run was not sent Skills', async () => {
    // A Custom-mode agent or a goal turn gets exactly its pinned tools. With
    // local-system pinned and Skills not, requiring `activateSkill` and
    // forbidding readFile left the advertised skill with no way to be opened.
    const system = await systemPromptFor(['lobe-local-system']);

    expect(system).toContain('calling the readFile tool on its `location` path');
    expect(system).not.toContain('do not bypass activation with readFile');
  });
});
