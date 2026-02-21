import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiChatService } from '@/services/aiChat';

import { type SupervisorContext } from './supervisor';
import { GroupChatSupervisor } from './supervisor';

vi.mock('@lobechat/prompts', () => ({
  contextSupervisorMakeDecision: vi.fn(() => ({
    messages: [{ content: 'structured-supervisor-prompt', role: 'user' }],
    temperature: 0.3,
    tools: [
      { function: { name: 'trigger_agent' }, type: 'function' },
      { function: { name: 'wait_for_user_input' }, type: 'function' },
      { function: { name: 'trigger_agent_dm' }, type: 'function' },
      { function: { name: 'create_todo' }, type: 'function' },
      { function: { name: 'finish_todo' }, type: 'function' },
    ],
  })),
}));

vi.mock('@/services/aiChat', () => ({
  aiChatService: {
    generateJSON: vi.fn(),
  },
}));

describe('GroupChatSupervisor', () => {
  const supervisor = new GroupChatSupervisor();

  const baseContext = {
    abortController: undefined,
    allowDM: true,
    availableAgents: [
      { id: 'agent-1', title: 'Agent One' },
      { id: 'agent-2', title: 'Agent Two' },
    ],
    groupId: 'group-1',
    messages: [
      {
        content: 'Hello',
        role: 'user',
      },
    ],
    model: 'gpt-4o',
    provider: 'openai',
    scene: 'productive',
    systemPrompt: 'You are a helpful supervisor',
    userName: 'Tester',
  } as unknown as SupervisorContext;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('should request structured completion and return filtered decisions', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.mocked(aiChatService.generateJSON).mockResolvedValue([
      { tool_name: 'create_todo', parameter: { content: 'Review action items' } },
      { tool_name: 'create_todo', parameter: { content: 'Prepare summary' } },
      {
        tool_name: 'trigger_agent',
        parameter: { id: 'agent-1', instruction: 'Say hello', target: 'user' },
      },
      {
        tool_name: 'trigger_agent',
        parameter: { id: 'unknown-agent', instruction: 'Ignore me' },
      },
    ]);

    const result = await supervisor.makeDecision({ ...baseContext });

    expect(aiChatService.generateJSON).toHaveBeenCalledTimes(1);
    const [payload] = vi.mocked(aiChatService.generateJSON).mock.calls[0];
    expect(payload).toMatchObject({
      messages: [{ content: 'structured-supervisor-prompt', role: 'user' }],
      model: 'gpt-4o',
      provider: 'openai',
      temperature: 0.3,
    });

    const toolNames = (payload.tools ?? []).map((tool: any) => tool.function.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'trigger_agent',
        'wait_for_user_input',
        'trigger_agent_dm',
        'create_todo',
        'finish_todo',
      ]),
    );

    expect(result.decisions).toEqual([
      {
        id: 'agent-1',
        instruction: 'Say hello',
        target: 'user',
      },
    ]);

    expect(result.todos).toEqual([
      { content: 'Review action items', finished: false },
      { content: 'Prepare summary', finished: false },
    ]);

    expect(result.todoUpdated).toBe(true);

    expect(logSpy).toHaveBeenCalledWith('Supervisor TODO list:', [
      { content: 'Review action items', finished: false },
      { content: 'Prepare summary', finished: false },
    ]);
    logSpy.mockRestore();
  });

  it('should parse structured response from JSON string fallback', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const payload = [
      '```json',
      '[',
      '  {',
      '    "tool_name": "create_todo",',
      '    "parameter": { "content": "Follow up with the user" }',
      '  },',
      '  {',
      '    "tool_name": "trigger_agent",',
      '    "parameter": { "id": "agent-2", "instruction": "Fallback", "target": "user" }',
      '  }',
      ']',
      '```',
    ].join('\n');

    vi.mocked(aiChatService.generateJSON).mockResolvedValue(payload);

    const result = await supervisor.makeDecision({ ...baseContext });

    expect(aiChatService.generateJSON).toHaveBeenCalled();
    expect(result.decisions).toEqual([
      {
        id: 'agent-2',
        instruction: 'Fallback',
        target: 'user',
      },
    ]);

    expect(result.todos).toEqual([{ content: 'Follow up with the user', finished: false }]);

    expect(result.todoUpdated).toBe(true);

    expect(logSpy).toHaveBeenCalledWith('Supervisor TODO list:', [
      { content: 'Follow up with the user', finished: false },
    ]);
    logSpy.mockRestore();
  });

  it('should wrap non-recoverable errors from structured completion', async () => {
    vi.mocked(aiChatService.generateJSON).mockRejectedValue(new Error('LLM error'));

    await expect(supervisor.makeDecision({ ...baseContext })).rejects.toThrow(
      'Supervisor decision failed: LLM error',
    );
  });
});
