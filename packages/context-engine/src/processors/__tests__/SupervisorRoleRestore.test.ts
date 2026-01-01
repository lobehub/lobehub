import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { SupervisorRoleRestoreProcessor } from '../SupervisorRoleRestore';

describe('SupervisorRoleRestoreProcessor', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  it('should restore supervisor role to assistant', async () => {
    const processor = new SupervisorRoleRestoreProcessor();
    const context = createContext([
      { content: 'Hello', role: 'user' },
      { content: 'I am the supervisor', role: 'supervisor' },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[1].role).toBe('assistant');
    expect(result.messages[1].content).toBe('I am the supervisor');
  });

  it('should NOT modify non-supervisor messages', async () => {
    const processor = new SupervisorRoleRestoreProcessor();
    const context = createContext([
      { content: 'Hello', role: 'user' },
      { content: 'Hi there', role: 'assistant' },
      { content: 'Tool result', role: 'tool' },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[1].role).toBe('assistant');
    expect(result.messages[2].role).toBe('tool');
  });

  it('should handle multiple supervisor messages', async () => {
    const processor = new SupervisorRoleRestoreProcessor();
    const context = createContext([
      { content: 'User message', role: 'user' },
      { content: 'Supervisor first', role: 'supervisor' },
      { content: 'Agent response', role: 'assistant' },
      { content: 'Supervisor second', role: 'supervisor' },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(4);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[1].role).toBe('assistant');
    expect(result.messages[1].content).toBe('Supervisor first');
    expect(result.messages[2].role).toBe('assistant');
    expect(result.messages[2].content).toBe('Agent response');
    expect(result.messages[3].role).toBe('assistant');
    expect(result.messages[3].content).toBe('Supervisor second');
  });

  it('should track processed count in metadata', async () => {
    const processor = new SupervisorRoleRestoreProcessor();
    const context = createContext([
      { content: 'User', role: 'user' },
      { content: 'Supervisor 1', role: 'supervisor' },
      { content: 'Supervisor 2', role: 'supervisor' },
    ]);

    const result = await processor.process(context);

    expect(result.metadata.supervisorRoleRestoreProcessed).toBe(2);
  });

  it('should preserve other message properties', async () => {
    const processor = new SupervisorRoleRestoreProcessor();
    const context = createContext([
      {
        agentId: 'agt_supervisor',
        content: 'Supervisor response',
        metadata: { isSupervisor: true },
        model: 'gpt-4',
        role: 'supervisor',
      },
    ]);

    const result = await processor.process(context);

    expect(result.messages[0].role).toBe('assistant');
    expect(result.messages[0].agentId).toBe('agt_supervisor');
    expect(result.messages[0].metadata).toEqual({ isSupervisor: true });
    expect(result.messages[0].model).toBe('gpt-4');
    expect(result.messages[0].content).toBe('Supervisor response');
  });

  it('should handle empty messages array', async () => {
    const processor = new SupervisorRoleRestoreProcessor();
    const context = createContext([]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(0);
    expect(result.metadata.supervisorRoleRestoreProcessed).toBe(0);
  });

  it('should handle messages with no supervisor role', async () => {
    const processor = new SupervisorRoleRestoreProcessor();
    const context = createContext([
      { content: 'User', role: 'user' },
      { content: 'Assistant', role: 'assistant' },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.metadata.supervisorRoleRestoreProcessed).toBe(0);
  });
});
