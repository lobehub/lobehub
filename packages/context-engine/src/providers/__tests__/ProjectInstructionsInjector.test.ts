import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { ProjectInstructionsInjector } from '../ProjectInstructionsInjector';

const createContext = (messages: any[]) => ({
  initialState: { messages: [], model: 'gpt-4', provider: 'openai', systemRole: '', tools: [] },
  isAborted: false,
  messages,
  metadata: { maxTokens: 4096, model: 'gpt-4' },
});

const systemMessage = {
  content: 'You are a helpful assistant.',
  createdAt: Date.now(),
  id: 'system-1',
  role: 'system',
  updatedAt: Date.now(),
};

/** The single system message the providers append to; asserted, not assumed. */
const systemContentOf = (result: PipelineContext): string => {
  const system = result.messages.find((message) => message.role === 'system');
  if (!system) throw new Error('expected a system message');
  return system.content as string;
};

const run = async (config: ConstructorParameters<typeof ProjectInstructionsInjector>[0]) =>
  new ProjectInstructionsInjector(config).process(createContext([systemMessage]) as any);

describe('ProjectInstructionsInjector', () => {
  it('wraps each file so the model can tell where an instruction came from', async () => {
    const result = await run({
      instructions: [
        { content: 'Use bun.', source: 'AGENTS.md' },
        { content: 'Prefer rebase.', source: 'CLAUDE.md' },
      ],
    });

    const system = systemContentOf(result);
    expect(system).toContain('<project_instructions source="AGENTS.md">\nUse bun.\n</project_instructions>');
    expect(system).toContain('<project_instructions source="CLAUDE.md">');
    // Appended after the persona, not replacing it.
    expect(system.startsWith('You are a helpful assistant.')).toBe(true);
    expect(result.metadata.projectInstructionCount).toBe(2);
  });

  it('keeps the files in the order they were collected', async () => {
    const result = await run({
      instructions: [
        { content: 'first', source: 'a.md' },
        { content: 'second', source: 'b.md' },
      ],
    });

    const system = systemContentOf(result);
    expect(system.indexOf('first')).toBeLessThan(system.indexOf('second'));
  });

  it('leaves the system message untouched when there are no files', async () => {
    for (const config of [{}, { instructions: [] }, { enabled: false, instructions: [{ content: 'x', source: 'a.md' }] }]) {
      const result = await run(config);
      expect(systemContentOf(result)).toBe('You are a helpful assistant.');
    }
  });
});
