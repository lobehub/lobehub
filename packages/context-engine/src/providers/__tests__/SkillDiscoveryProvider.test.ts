import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import type { SkillMeta } from '../SkillContextProvider';
import { SkillDiscoveryProvider } from '../SkillDiscoveryProvider';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] } as any,
  isAborted: false,
  messages,
  metadata: { maxTokens: 4096, model: 'gpt-4' },
});

const createSkills = (): SkillMeta[] => [
  {
    description: 'Generate interactive UI components',
    identifier: 'artifacts',
    location: '/path/to/skills/artifacts/SKILL.md',
    name: 'Artifacts',
  },
  {
    description: 'Custom skill description',
    identifier: 'my-skill',
    name: 'My Skill',
  },
];

describe('SkillDiscoveryProvider', () => {
  it('should inject <available_skills> before the first user message, not into system', async () => {
    const provider = new SkillDiscoveryProvider({ enabledSkills: createSkills() });

    const ctx = createContext([
      { content: 'You are a helpful assistant.', id: 's1', role: 'system' },
      { content: 'Hello', id: 'u1', role: 'user' },
    ]);
    const result = await provider.process(ctx);

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].content).toBe('You are a helpful assistant.');
    expect(result.messages[1].role).toBe('user');
    expect(result.messages[1].meta).toEqual({ systemInjection: true });
    expect(result.messages[1].content).toMatchSnapshot();
    expect(result.messages[2].content).toBe('Hello');

    expect(result.metadata.skillDiscoveryContext).toEqual({ injected: true, skillsCount: 2 });
  });

  it('should exclude activated skills from the list', async () => {
    const provider = new SkillDiscoveryProvider({
      enabledSkills: [
        {
          activated: true,
          content: 'Task skill content here',
          description: 'Task management',
          identifier: 'task',
          name: 'Task',
        },
        ...createSkills(),
      ],
    });

    const ctx = createContext([{ content: 'Hello', id: 'u1', role: 'user' }]);
    const result = await provider.process(ctx);

    const injected = result.messages[0].content as string;
    expect(injected).toContain('<skill name="Artifacts"');
    expect(injected).not.toContain('<skill name="Task"');
    expect(result.metadata.skillDiscoveryContext).toEqual({ injected: true, skillsCount: 2 });
  });

  it('should append to an existing injection message', async () => {
    const provider = new SkillDiscoveryProvider({ enabledSkills: createSkills() });

    const ctx = createContext([
      {
        content: '<user_memory>x</user_memory>',
        id: 'i1',
        meta: { systemInjection: true },
        role: 'user',
      },
      { content: 'Hello', id: 'u1', role: 'user' },
    ]);
    const result = await provider.process(ctx);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toMatch(
      /^<user_memory>x<\/user_memory>\n\n<available_skills>/,
    );
  });

  it('should skip injection when every skill is activated', async () => {
    const provider = new SkillDiscoveryProvider({
      enabledSkills: [
        {
          activated: true,
          content: 'Task skill content here',
          description: 'Task management',
          identifier: 'task',
          name: 'Task',
        },
      ],
    });

    const ctx = createContext([{ content: 'Hello', id: 'u1', role: 'user' }]);
    const result = await provider.process(ctx);

    expect(result.messages).toHaveLength(1);
    expect(result.metadata.skillDiscoveryContext).toBeUndefined();
  });

  it('should skip injection when disabled', async () => {
    const provider = new SkillDiscoveryProvider({ enabled: false, enabledSkills: createSkills() });

    const ctx = createContext([{ content: 'Hello', id: 'u1', role: 'user' }]);
    const result = await provider.process(ctx);

    expect(result.messages).toHaveLength(1);
    expect(result.metadata.skillDiscoveryContext).toBeUndefined();
  });
});
