import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import type { SkillMeta } from '../SkillContextProvider';
import { SkillContextProvider } from '../SkillContextProvider';

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

describe('SkillContextProvider', () => {
  it('should inject skill metadata when skills are provided', async () => {
    const skills = createSkills();
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toMatchSnapshot();

    expect(result.metadata.skillContext).toEqual({
      injected: true,
      skillsCount: 2,
    });
  });

  it('should merge with existing system message', async () => {
    const skills = createSkills();
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const existingSystemContent = 'You are a helpful assistant.';
    const messages = [
      { content: existingSystemContent, id: 's1', role: 'system' },
      { content: 'Hello', id: 'u1', role: 'user' },
    ];

    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toMatchSnapshot();
  });

  it('should skip injection when no skills are provided', async () => {
    const provider = new SkillContextProvider({ enabledSkills: [] });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeUndefined();
    expect(result.metadata.skillContext).toBeUndefined();
  });

  it('should render XML with location attribute', async () => {
    const skills: SkillMeta[] = [
      {
        description: 'Extracts text from PDF files',
        identifier: 'pdf-processing',
        location: '/path/to/skills/pdf-processing/SKILL.md',
        name: 'PDF Processing',
      },
      {
        description: 'Analyzes datasets and generates charts',
        identifier: 'data-analysis',
        location: '/path/to/skills/data-analysis/SKILL.md',
        name: 'Data Analysis',
      },
    ];
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toMatchSnapshot();
  });

  it('should render XML without location when not provided', async () => {
    const skills: SkillMeta[] = [
      {
        description: 'Custom skill description',
        identifier: 'my-skill',
        name: 'My Skill',
      },
    ];
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toMatchSnapshot();
  });

  it('should directly inject content for activated skills', async () => {
    const skills: SkillMeta[] = [
      {
        activated: true,
        content: '<task_guides>\nUse `lh task` to manage tasks.\n</task_guides>',
        description: 'Task management via CLI',
        identifier: 'task',
        name: 'Task',
      },
      {
        description: 'Generate interactive UI components',
        identifier: 'artifacts',
        name: 'Artifacts',
      },
    ];
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toMatchSnapshot();

    // Activated skill should NOT appear in <available_skills> list
    expect(systemMessage!.content).not.toContain('<skill name="Task">');

    expect(result.metadata.skillContext).toEqual({
      injected: true,
      skillsCount: 2,
    });
  });

  it('should handle all skills activated (no available_skills list)', async () => {
    const skills: SkillMeta[] = [
      {
        activated: true,
        content: 'Task skill content here',
        description: 'Task management',
        identifier: 'task',
        name: 'Task',
      },
    ];
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toMatchSnapshot();
    expect(systemMessage!.content).not.toContain('<available_skills>');
  });

  it('should skip activated skill without content', async () => {
    const skills: SkillMeta[] = [
      {
        activated: true,
        // no content provided
        description: 'Broken skill',
        identifier: 'broken',
        name: 'Broken',
      },
      {
        description: 'Working skill',
        identifier: 'working',
        name: 'Working',
      },
    ];
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    // Broken skill (activated but no content) should fall through to available list
    expect(systemMessage!.content).toContain('<available_skills>');
    expect(systemMessage!.content).toContain('Working');
  });

  it('should only inject lightweight metadata without content field', async () => {
    const skills: SkillMeta[] = [
      {
        description: 'Generate interactive UI components',
        identifier: 'artifacts',
        location: '/path/to/skills/artifacts/SKILL.md',
        name: 'Artifacts',
      },
    ];
    const provider = new SkillContextProvider({ enabledSkills: skills });

    const messages = [{ content: 'Hello', id: 'u1', role: 'user' }];
    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).not.toContain('<content>');
    expect(systemMessage!.content).toMatchSnapshot();
  });
});
