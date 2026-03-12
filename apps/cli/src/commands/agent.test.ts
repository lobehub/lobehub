import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { registerAgentCommand } from './agent';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    agent: {
      createAgent: { mutate: vi.fn() },
      createAgentFiles: { mutate: vi.fn() },
      createAgentKnowledgeBase: { mutate: vi.fn() },
      deleteAgentFile: { mutate: vi.fn() },
      deleteAgentKnowledgeBase: { mutate: vi.fn() },
      duplicateAgent: { mutate: vi.fn() },
      getAgentConfigById: { query: vi.fn() },
      getBuiltinAgent: { query: vi.fn() },
      getKnowledgeBasesAndFiles: { query: vi.fn() },
      queryAgents: { query: vi.fn() },
      removeAgent: { mutate: vi.fn() },
      toggleFile: { mutate: vi.fn() },
      toggleKnowledgeBase: { mutate: vi.fn() },
      updateAgentConfig: { mutate: vi.fn() },
      updateAgentPinned: { mutate: vi.fn() },
    },
    aiAgent: {
      execAgent: { mutate: vi.fn() },
      getOperationStatus: { query: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

const { mockStreamAgentEvents } = vi.hoisted(() => ({
  mockStreamAgentEvents: vi.fn(),
}));

const { mockGetAuthInfo } = vi.hoisted(() => ({
  mockGetAuthInfo: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../api/http', () => ({ getAuthInfo: mockGetAuthInfo }));
vi.mock('../utils/agentStream', () => ({ streamAgentEvents: mockStreamAgentEvents }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), heartbeat: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

describe('agent command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockGetAuthInfo.mockResolvedValue({
      accessToken: 'test-token',
      headers: { 'Content-Type': 'application/json', 'Oidc-Auth': 'test-token' },
      serverUrl: 'https://example.com',
    });
    mockStreamAgentEvents.mockResolvedValue(undefined);
    for (const method of Object.values(mockTrpcClient.agent)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
    for (const method of Object.values(mockTrpcClient.aiAgent)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerAgentCommand(program);
    return program;
  }

  describe('list', () => {
    it('should display agents in table format', async () => {
      mockTrpcClient.agent.queryAgents.query.mockResolvedValue([
        { id: 'a1', model: 'gpt-4', title: 'My Agent' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'list']);

      expect(consoleSpy).toHaveBeenCalledTimes(2); // header + row
    });

    it('should filter by keyword', async () => {
      mockTrpcClient.agent.queryAgents.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'list', '-k', 'test']);

      expect(mockTrpcClient.agent.queryAgents.query).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'test' }),
      );
    });

    it('should output JSON', async () => {
      const agents = [{ id: 'a1', title: 'Test' }];
      mockTrpcClient.agent.queryAgents.query.mockResolvedValue(agents);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'list', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(agents, null, 2));
    });
  });

  describe('view', () => {
    it('should display agent config', async () => {
      mockTrpcClient.agent.getAgentConfigById.query.mockResolvedValue({
        model: 'gpt-4',
        systemRole: 'You are helpful.',
        title: 'Test Agent',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'view', 'a1']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test Agent'));
    });

    it('should exit when not found', async () => {
      mockTrpcClient.agent.getAgentConfigById.query.mockResolvedValue(null);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'view', 'nonexistent']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should support --slug option', async () => {
      mockTrpcClient.agent.getBuiltinAgent.query.mockResolvedValue({
        id: 'resolved-id',
        model: 'gpt-4',
        title: 'Inbox Agent',
      });
      mockTrpcClient.agent.getAgentConfigById.query.mockResolvedValue({
        id: 'resolved-id',
        model: 'gpt-4',
        title: 'Inbox Agent',
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'view', '--slug', 'inbox']);

      expect(mockTrpcClient.agent.getBuiltinAgent.query).toHaveBeenCalledWith({ slug: 'inbox' });
      expect(mockTrpcClient.agent.getAgentConfigById.query).toHaveBeenCalledWith({
        agentId: 'resolved-id',
      });
    });
  });

  describe('create', () => {
    it('should create an agent', async () => {
      mockTrpcClient.agent.createAgent.mutate.mockResolvedValue({
        agentId: 'a-new',
        sessionId: 's1',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'create',
        '--title',
        'My Agent',
        '--model',
        'gpt-4',
      ]);

      expect(mockTrpcClient.agent.createAgent.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ model: 'gpt-4', title: 'My Agent' }),
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('a-new'));
    });
  });

  describe('edit', () => {
    it('should update agent config', async () => {
      mockTrpcClient.agent.updateAgentConfig.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'edit', 'a1', '--title', 'Updated']);

      expect(mockTrpcClient.agent.updateAgentConfig.mutate).toHaveBeenCalledWith({
        agentId: 'a1',
        value: { title: 'Updated' },
      });
    });

    it('should exit when no changes specified', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'edit', 'a1']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('No changes'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should support --slug option', async () => {
      mockTrpcClient.agent.getBuiltinAgent.query.mockResolvedValue({
        id: 'resolved-id',
        title: 'Inbox Agent',
      });
      mockTrpcClient.agent.updateAgentConfig.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'edit',
        '--slug',
        'inbox',
        '--model',
        'gemini-3-pro',
      ]);

      expect(mockTrpcClient.agent.getBuiltinAgent.query).toHaveBeenCalledWith({ slug: 'inbox' });
      expect(mockTrpcClient.agent.updateAgentConfig.mutate).toHaveBeenCalledWith({
        agentId: 'resolved-id',
        value: { model: 'gemini-3-pro' },
      });
    });
  });

  describe('delete', () => {
    it('should delete with --yes', async () => {
      mockTrpcClient.agent.removeAgent.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'delete', 'a1', '--yes']);

      expect(mockTrpcClient.agent.removeAgent.mutate).toHaveBeenCalledWith({ agentId: 'a1' });
    });
  });

  describe('duplicate', () => {
    it('should duplicate an agent', async () => {
      mockTrpcClient.agent.duplicateAgent.mutate.mockResolvedValue({ agentId: 'a-dup' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'duplicate', 'a1', '--title', 'Copy']);

      expect(mockTrpcClient.agent.duplicateAgent.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1', newTitle: 'Copy' }),
      );
    });
  });

  describe('run', () => {
    it('should exec agent and connect to SSE stream', async () => {
      mockTrpcClient.aiAgent.execAgent.mutate.mockResolvedValue({
        operationId: 'op-123',
        success: true,
        topicId: 'topic-1',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'run',
        '--agent-id',
        'a1',
        '--prompt',
        'Hello',
      ]);

      expect(mockTrpcClient.aiAgent.execAgent.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1', prompt: 'Hello' }),
      );
      expect(mockStreamAgentEvents).toHaveBeenCalledWith(
        'https://example.com/api/agent/stream?operationId=op-123',
        expect.objectContaining({ 'Oidc-Auth': 'test-token' }),
        expect.objectContaining({ json: undefined, verbose: undefined }),
      );
    });

    it('should support --slug option', async () => {
      mockTrpcClient.aiAgent.execAgent.mutate.mockResolvedValue({
        operationId: 'op-456',
        success: true,
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'run',
        '--slug',
        'my-agent',
        '--prompt',
        'Do something',
      ]);

      expect(mockTrpcClient.aiAgent.execAgent.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'my-agent', prompt: 'Do something' }),
      );
    });

    it('should exit when neither --agent-id nor --slug provided', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'run', '--prompt', 'Hello']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('--agent-id or --slug'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when --prompt not provided', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'run', '--agent-id', 'a1']);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('--prompt'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when exec fails', async () => {
      mockTrpcClient.aiAgent.execAgent.mutate.mockResolvedValue({
        error: 'Agent not found',
        success: false,
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'run',
        '--agent-id',
        'bad',
        '--prompt',
        'Hi',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Agent not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should pass --topic-id as appContext', async () => {
      mockTrpcClient.aiAgent.execAgent.mutate.mockResolvedValue({
        operationId: 'op-789',
        success: true,
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'run',
        '--agent-id',
        'a1',
        '--prompt',
        'Hi',
        '--topic-id',
        't1',
      ]);

      expect(mockTrpcClient.aiAgent.execAgent.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ appContext: { topicId: 't1' } }),
      );
    });

    it('should pass --json to stream options', async () => {
      mockTrpcClient.aiAgent.execAgent.mutate.mockResolvedValue({
        operationId: 'op-j',
        success: true,
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'run',
        '--agent-id',
        'a1',
        '--prompt',
        'Hi',
        '--json',
      ]);

      expect(mockStreamAgentEvents).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ json: true }),
      );
    });
  });

  describe('pin/unpin', () => {
    it('should pin an agent', async () => {
      mockTrpcClient.agent.updateAgentPinned.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'pin', 'a1']);

      expect(mockTrpcClient.agent.updateAgentPinned.mutate).toHaveBeenCalledWith({
        id: 'a1',
        pinned: true,
      });
    });

    it('should unpin an agent', async () => {
      mockTrpcClient.agent.updateAgentPinned.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'unpin', 'a1']);

      expect(mockTrpcClient.agent.updateAgentPinned.mutate).toHaveBeenCalledWith({
        id: 'a1',
        pinned: false,
      });
    });
  });

  describe('kb-files', () => {
    it('should list kb and files', async () => {
      mockTrpcClient.agent.getKnowledgeBasesAndFiles.query.mockResolvedValue([
        { enabled: true, id: 'f1', name: 'file.txt', type: 'file' },
      ]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'kb-files', 'a1']);

      expect(mockTrpcClient.agent.getKnowledgeBasesAndFiles.query).toHaveBeenCalledWith({
        agentId: 'a1',
      });
    });

    it('should show empty message', async () => {
      mockTrpcClient.agent.getKnowledgeBasesAndFiles.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'kb-files', 'a1']);

      expect(consoleSpy).toHaveBeenCalledWith('No knowledge bases or files found.');
    });
  });

  describe('add-file', () => {
    it('should add files to agent', async () => {
      mockTrpcClient.agent.createAgentFiles.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'add-file', 'a1', '--file-ids', 'f1,f2']);

      expect(mockTrpcClient.agent.createAgentFiles.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1', fileIds: ['f1', 'f2'] }),
      );
    });
  });

  describe('remove-file', () => {
    it('should remove a file from agent', async () => {
      mockTrpcClient.agent.deleteAgentFile.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'remove-file', 'a1', '--file-id', 'f1']);

      expect(mockTrpcClient.agent.deleteAgentFile.mutate).toHaveBeenCalledWith({
        agentId: 'a1',
        fileId: 'f1',
      });
    });
  });

  describe('toggle-file', () => {
    it('should toggle file with enable', async () => {
      mockTrpcClient.agent.toggleFile.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'toggle-file',
        'a1',
        '--file-id',
        'f1',
        '--enable',
      ]);

      expect(mockTrpcClient.agent.toggleFile.mutate).toHaveBeenCalledWith({
        agentId: 'a1',
        enabled: true,
        fileId: 'f1',
      });
    });
  });

  describe('add-kb', () => {
    it('should add kb to agent', async () => {
      mockTrpcClient.agent.createAgentKnowledgeBase.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'add-kb', 'a1', '--kb-id', 'kb1']);

      expect(mockTrpcClient.agent.createAgentKnowledgeBase.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1', knowledgeBaseId: 'kb1' }),
      );
    });
  });

  describe('remove-kb', () => {
    it('should remove kb from agent', async () => {
      mockTrpcClient.agent.deleteAgentKnowledgeBase.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'remove-kb', 'a1', '--kb-id', 'kb1']);

      expect(mockTrpcClient.agent.deleteAgentKnowledgeBase.mutate).toHaveBeenCalledWith({
        agentId: 'a1',
        knowledgeBaseId: 'kb1',
      });
    });
  });

  describe('toggle-kb', () => {
    it('should toggle kb with disable', async () => {
      mockTrpcClient.agent.toggleKnowledgeBase.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'toggle-kb',
        'a1',
        '--kb-id',
        'kb1',
        '--disable',
      ]);

      expect(mockTrpcClient.agent.toggleKnowledgeBase.mutate).toHaveBeenCalledWith({
        agentId: 'a1',
        enabled: false,
        knowledgeBaseId: 'kb1',
      });
    });
  });

  describe('status', () => {
    it('should display operation status', async () => {
      mockTrpcClient.aiAgent.getOperationStatus.query.mockResolvedValue({
        cost: { total: 0.0042 },
        status: 'completed',
        stepCount: 3,
        usage: { total_tokens: 1500 },
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'status', 'op-123']);

      expect(mockTrpcClient.aiAgent.getOperationStatus.query).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'op-123' }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Operation Status'));
    });

    it('should output JSON', async () => {
      const data = { status: 'completed', stepCount: 2 };
      mockTrpcClient.aiAgent.getOperationStatus.query.mockResolvedValue(data);

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'status', 'op-123', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
    });

    it('should pass --history flag', async () => {
      mockTrpcClient.aiAgent.getOperationStatus.query.mockResolvedValue({ status: 'running' });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'agent', 'status', 'op-123', '--history']);

      expect(mockTrpcClient.aiAgent.getOperationStatus.query).toHaveBeenCalledWith(
        expect.objectContaining({ includeHistory: true }),
      );
    });
  });
});
