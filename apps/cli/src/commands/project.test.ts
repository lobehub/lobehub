import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectCommand } from './project';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    project: {
      acceptCompletion: { mutate: vi.fn() },
      addAgent: { mutate: vi.fn() },
      addKnowledgeBase: { mutate: vi.fn() },
      create: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      detail: { query: vi.fn() },
      list: { query: vi.fn() },
      moveTask: { mutate: vi.fn() },
      rejectCompletion: { mutate: vi.fn() },
      removeAgent: { mutate: vi.fn() },
      removeKnowledgeBase: { mutate: vi.fn() },
      reopen: { mutate: vi.fn() },
      requestCompletion: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
      updateStatus: { mutate: vi.fn() },
    },
    task: { create: { mutate: vi.fn() } },
  },
}));

vi.mock('../api/client', () => ({ getTrpcClient: vi.fn().mockResolvedValue(mockClient) }));
vi.mock('../utils/logger', () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

function createProgram() {
  const program = new Command();
  program.exitOverride();
  registerProjectCommand(program);
  return program;
}

describe('project command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('creates a project', async () => {
    mockClient.project.create.mutate.mockResolvedValue({ data: { id: 'prj_1' } });
    await createProgram().parseAsync([
      'node',
      'test',
      'project',
      'create',
      '--name',
      'Apollo',
      '--identifier',
      'LOBE',
      '--visibility',
      'private',
    ]);
    expect(mockClient.project.create.mutate).toHaveBeenCalledWith({
      identifier: 'LOBE',
      name: 'Apollo',
      visibility: 'private',
    });
  });

  it('binds an agent with its project role', async () => {
    mockClient.project.addAgent.mutate.mockResolvedValue({ success: true });
    await createProgram().parseAsync([
      'node',
      'test',
      'project',
      'agent',
      'add',
      'prj_1',
      'agent_1',
      '--role',
      'lead',
    ]);
    expect(mockClient.project.addAgent.mutate).toHaveBeenCalledWith({
      agentId: 'agent_1',
      id: 'prj_1',
      role: 'lead',
    });
  });

  it('creates a task directly in the project', async () => {
    mockClient.task.create.mutate.mockResolvedValue({ data: { identifier: 'T-1' } });
    await createProgram().parseAsync([
      'node',
      'test',
      'project',
      'task',
      'create',
      'prj_1',
      '--instruction',
      'Ship it',
      '--agent',
      'agent_1',
    ]);
    expect(mockClient.task.create.mutate).toHaveBeenCalledWith({
      assigneeAgentId: 'agent_1',
      instruction: 'Ship it',
      name: undefined,
      parentTaskId: undefined,
      projectId: 'prj_1',
    });
  });

  it('requests and accepts human completion review', async () => {
    mockClient.project.requestCompletion.mutate.mockResolvedValue({ success: true });
    mockClient.project.acceptCompletion.mutate.mockResolvedValue({ success: true });
    await createProgram().parseAsync(['node', 'test', 'project', 'request-review', 'prj_1']);
    await createProgram().parseAsync([
      'node',
      'test',
      'project',
      'accept',
      'prj_1',
      '--comment',
      'Approved',
    ]);
    expect(mockClient.project.requestCompletion.mutate).toHaveBeenCalledWith({ id: 'prj_1' });
    expect(mockClient.project.acceptCompletion.mutate).toHaveBeenCalledWith({
      comment: 'Approved',
      id: 'prj_1',
    });
  });
});
