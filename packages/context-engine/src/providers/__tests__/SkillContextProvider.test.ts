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

const activatedTask: SkillMeta = {
  activated: true,
  content: '<task_guides>\nUse `lh task` to manage tasks.\n</task_guides>',
  description: 'Task management via CLI',
  identifier: 'task',
  name: 'Task',
};

const availableArtifacts: SkillMeta = {
  description: 'Generate interactive UI components',
  identifier: 'artifacts',
  location: '/path/to/skills/artifacts/SKILL.md',
  name: 'Artifacts',
};

describe('SkillContextProvider', () => {
  it('should inject activated skill content into the system message', async () => {
    const provider = new SkillContextProvider({
      enabledSkills: [activatedTask, availableArtifacts],
    });

    const ctx = createContext([{ content: 'Hello', id: 'u1', role: 'user' }]);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toBe(activatedTask.content);
    expect(result.metadata.skillContext).toEqual({ injected: true, skillsCount: 1 });
  });

  it('should not put the <available_skills> list into the system message', async () => {
    const provider = new SkillContextProvider({
      enabledSkills: [activatedTask, availableArtifacts],
    });

    const ctx = createContext([{ content: 'Hello', id: 'u1', role: 'user' }]);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).not.toContain('<available_skills>');
    expect(systemMessage!.content).not.toContain('Artifacts');
  });

  it('should merge with existing system message', async () => {
    const provider = new SkillContextProvider({ enabledSkills: [activatedTask] });

    const ctx = createContext([
      { content: 'You are a helpful assistant.', id: 's1', role: 'system' },
      { content: 'Hello', id: 'u1', role: 'user' },
    ]);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toBe(`You are a helpful assistant.\n\n${activatedTask.content}`);
  });

  it('should join multiple activated skills', async () => {
    const provider = new SkillContextProvider({
      enabledSkills: [activatedTask, { ...activatedTask, content: 'Second', identifier: 'second' }],
    });

    const ctx = createContext([{ content: 'Hello', id: 'u1', role: 'user' }]);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toBe(`${activatedTask.content}\n\nSecond`);
  });

  it('should skip injection when no skill is activated', async () => {
    const provider = new SkillContextProvider({ enabledSkills: [availableArtifacts] });

    const ctx = createContext([{ content: 'Hello', id: 'u1', role: 'user' }]);
    const result = await provider.process(ctx);

    expect(result.messages.find((msg) => msg.role === 'system')).toBeUndefined();
    expect(result.metadata.skillContext).toBeUndefined();
  });

  it('should skip an activated skill without content', async () => {
    const provider = new SkillContextProvider({
      enabledSkills: [{ ...activatedTask, content: undefined }],
    });

    const ctx = createContext([{ content: 'Hello', id: 'u1', role: 'user' }]);
    const result = await provider.process(ctx);

    expect(result.messages.find((msg) => msg.role === 'system')).toBeUndefined();
  });

  it('should skip injection when disabled', async () => {
    const provider = new SkillContextProvider({ enabled: false, enabledSkills: [activatedTask] });

    const ctx = createContext([{ content: 'Hello', id: 'u1', role: 'user' }]);
    const result = await provider.process(ctx);

    expect(result.messages.find((msg) => msg.role === 'system')).toBeUndefined();
  });
});
