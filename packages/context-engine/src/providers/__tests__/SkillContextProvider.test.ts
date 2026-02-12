import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { SkillContextProvider } from '../SkillContextProvider';
import type { SkillMeta } from '../SkillContextProvider';

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
