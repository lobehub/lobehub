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
    agentDocument: {
      copyDocumentByPath: { mutate: vi.fn() },
      deleteDocumentByPath: { mutate: vi.fn() },
      deleteDocumentPermanentlyByPath: { mutate: vi.fn() },
      statDocumentByPath: { query: vi.fn() },
      listDocumentsByPath: { query: vi.fn() },
      listTrashDocumentsByPath: { query: vi.fn() },
      mkdirDocumentByPath: { mutate: vi.fn() },
      readDocumentByPath: { query: vi.fn() },
      renameDocumentByPath: { mutate: vi.fn() },
      restoreDocumentFromTrashByPath: { mutate: vi.fn() },
      writeDocumentByPath: { mutate: vi.fn() },
    },
    agentSkills: {
      createSkill: { mutate: vi.fn() },
      deleteSkill: { mutate: vi.fn() },
      updateSkill: { mutate: vi.fn() },
    },
    aiAgent: {
      execAgent: { mutate: vi.fn() },
      getOperationStatus: { query: vi.fn() },
    },
    device: {
      listDevices: { query: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

const { mockStreamAgentEvents } = vi.hoisted(() => ({
  mockStreamAgentEvents: vi.fn(),
}));

const { mockReplayAgentEvents, mockStreamAgentEventsViaWebSocket } = vi.hoisted(() => ({
  mockReplayAgentEvents: vi.fn(),
  mockStreamAgentEventsViaWebSocket: vi.fn(),
}));

const { mockGetAgentStreamAuthInfo } = vi.hoisted(() => ({
  mockGetAgentStreamAuthInfo: vi.fn(),
}));

const { mockResolveLocalDeviceId } = vi.hoisted(() => ({
  mockResolveLocalDeviceId: vi.fn(),
}));

const { mockReadStdinText } = vi.hoisted(() => ({
  mockReadStdinText: vi.fn(),
}));

vi.mock('node:stream/consumers', () => ({ text: mockReadStdinText }));
vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../api/http', () => ({ getAgentStreamAuthInfo: mockGetAgentStreamAuthInfo }));
vi.mock('../utils/agentStream', () => ({
  replayAgentEvents: mockReplayAgentEvents,
  streamAgentEvents: mockStreamAgentEvents,
  streamAgentEventsViaWebSocket: mockStreamAgentEventsViaWebSocket,
}));
vi.mock('../utils/device', () => ({ resolveLocalDeviceId: mockResolveLocalDeviceId }));
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
    mockGetAgentStreamAuthInfo.mockResolvedValue({
      headers: { 'Oidc-Auth': 'test-token' },
      serverUrl: 'https://example.com',
    });
    mockStreamAgentEvents.mockResolvedValue(undefined);
    mockReplayAgentEvents.mockReset();
    mockStreamAgentEventsViaWebSocket.mockReset();
    mockStreamAgentEventsViaWebSocket.mockResolvedValue(undefined);
    mockResolveLocalDeviceId.mockReset();
    mockReadStdinText.mockReset();
    for (const method of Object.values(mockTrpcClient.agent)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
    for (const method of Object.values(mockTrpcClient.agentDocument)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
    for (const method of Object.values(mockTrpcClient.agentSkills)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
    for (const method of Object.values(mockTrpcClient.aiAgent)) {
      for (const fn of Object.values(method)) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
    for (const method of Object.values(mockTrpcClient.device)) {
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
    it('should exec agent and connect to the gateway WebSocket stream by default', async () => {
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
      expect(mockStreamAgentEventsViaWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewayUrl: expect.any(String),
          json: undefined,
          operationId: 'op-123',
          serverUrl: 'https://example.com',
          token: undefined,
          tokenType: undefined,
          verbose: undefined,
        }),
      );
      expect(mockStreamAgentEvents).not.toHaveBeenCalled();
    });

    it('should fall back to SSE when --sse is provided', async () => {
      mockTrpcClient.aiAgent.execAgent.mutate.mockResolvedValue({
        operationId: 'op-sse',
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
        'Hello',
        '--sse',
      ]);

      expect(mockStreamAgentEvents).toHaveBeenCalledWith(
        'https://example.com/api/agent/stream?operationId=op-sse',
        expect.objectContaining({ 'Oidc-Auth': 'test-token' }),
        expect.objectContaining({ json: undefined, verbose: undefined }),
      );
      expect(mockStreamAgentEventsViaWebSocket).not.toHaveBeenCalled();
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

    it('should pass --device local as deviceId', async () => {
      mockResolveLocalDeviceId.mockReturnValue('local-device-1');
      mockTrpcClient.device.listDevices.query.mockResolvedValue([
        { deviceId: 'local-device-1', online: true },
      ]);
      mockTrpcClient.aiAgent.execAgent.mutate.mockResolvedValue({
        operationId: 'op-device',
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
        '--device',
        'local',
      ]);

      expect(mockTrpcClient.aiAgent.execAgent.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1', deviceId: 'local-device-1', prompt: 'Hi' }),
      );
    });

    it('should pass --topic-id and --device local together', async () => {
      mockResolveLocalDeviceId.mockReturnValue('local-device-1');
      mockTrpcClient.device.listDevices.query.mockResolvedValue([
        { deviceId: 'local-device-1', online: true },
      ]);
      mockTrpcClient.aiAgent.execAgent.mutate.mockResolvedValue({
        operationId: 'op-topic-device',
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
        '--device',
        'local',
      ]);

      expect(mockTrpcClient.aiAgent.execAgent.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ appContext: { topicId: 't1' }, deviceId: 'local-device-1' }),
      );
    });

    it('should pass explicit --device id as deviceId', async () => {
      mockTrpcClient.device.listDevices.query.mockResolvedValue([
        { deviceId: 'device-remote-1', online: true },
      ]);
      mockTrpcClient.aiAgent.execAgent.mutate.mockResolvedValue({
        operationId: 'op-explicit-device',
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
        '--device',
        'device-remote-1',
      ]);

      expect(mockResolveLocalDeviceId).not.toHaveBeenCalled();
      expect(mockTrpcClient.aiAgent.execAgent.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1', deviceId: 'device-remote-1', prompt: 'Hi' }),
      );
    });

    it('should exit when explicit device is not found', async () => {
      mockTrpcClient.device.listDevices.query.mockResolvedValue([
        { deviceId: 'other-device', online: true },
      ]);

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
        '--device',
        'device-remote-1',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('was not found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when local device cannot be resolved', async () => {
      mockResolveLocalDeviceId.mockReturnValue(undefined);

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
        '--device',
        'local',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining("Run 'lh connect' first"));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when local device is offline', async () => {
      mockResolveLocalDeviceId.mockReturnValue('local-device-1');
      mockTrpcClient.device.listDevices.query.mockResolvedValue([
        { deviceId: 'local-device-1', online: false },
      ]);

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
        '--device',
        'local',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('is not online'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit when explicit device is offline', async () => {
      mockTrpcClient.device.listDevices.query.mockResolvedValue([
        { deviceId: 'device-remote-1', online: false },
      ]);

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
        '--device',
        'device-remote-1',
      ]);

      expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Bring it online'));
      expect(exitSpy).toHaveBeenCalledWith(1);
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

      expect(mockStreamAgentEventsViaWebSocket).toHaveBeenCalledWith(
        expect.objectContaining({ json: true, operationId: 'op-j' }),
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

  describe('fs', () => {
    it('should list VFS entries from the unified agent root alias', async () => {
      mockTrpcClient.agentDocument.listDocumentsByPath.query.mockResolvedValue([
        {
          mode: 8,
          mount: { driver: 'synthetic', source: 'virtual' },
          name: 'writer',
          path: './lobe',
          type: 'directory',
        },
      ]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'ls',
        '--agent-id',
        'a1',
        'agent:/',
        '--json',
      ]);

      expect(mockTrpcClient.agentDocument.listDocumentsByPath.query).toHaveBeenCalledWith({
        agentId: 'a1',
        cursor: undefined,
        limit: undefined,
        path: './',
        topicId: undefined,
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        JSON.stringify(
          [
            {
              mode: 8,
              mount: { driver: 'synthetic', source: 'virtual' },
              name: 'writer',
              path: './lobe',
              type: 'directory',
            },
          ],
          null,
          2,
        ),
      );
    });

    it('should pass pagination options to VFS ls', async () => {
      mockTrpcClient.agentDocument.listDocumentsByPath.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'ls',
        '--agent-id',
        'a1',
        '--cursor',
        '100',
        '--limit',
        '25',
        'agent:/notes',
      ]);

      expect(mockTrpcClient.agentDocument.listDocumentsByPath.query).toHaveBeenCalledWith({
        agentId: 'a1',
        cursor: '100',
        limit: 25,
        path: './notes',
        topicId: undefined,
      });
    });

    it('should print unix-like long listings with ls -la', async () => {
      mockTrpcClient.agentDocument.listDocumentsByPath.query.mockResolvedValue([
        {
          mode: 14,
          name: '.config',
          path: './notes/.config',
          size: 0,
          type: 'directory',
          updatedAt: '2026-04-27T07:18:00',
        },
        {
          mode: 6,
          name: 'SOUL.md',
          path: './notes/SOUL.md',
          size: 399,
          type: 'file',
          updatedAt: '2026-04-27T07:19:00',
        },
      ]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'ls',
        '-la',
        '--agent-id',
        'a1',
        'agent:/notes',
      ]);

      expect(consoleSpy).toHaveBeenNthCalledWith(1, 'total 1');
      expect(consoleSpy).toHaveBeenNthCalledWith(
        2,
        expect.stringMatching(/^dr-x------ {2}1 agent {2}agent {4}0 --- -- --:-- \.$/),
      );
      expect(consoleSpy).toHaveBeenNthCalledWith(
        3,
        expect.stringMatching(/^dr-x------ {2}1 agent {2}agent {4}0 --- -- --:-- \.\.$/),
      );
      expect(consoleSpy).toHaveBeenNthCalledWith(
        4,
        expect.stringMatching(/^drwx------ {2}1 agent {2}agent {4}0 Apr 27 07:18 \.config\/$/),
      );
      expect(consoleSpy).toHaveBeenNthCalledWith(
        5,
        expect.stringMatching(/^-rw------- {2}1 agent {2}agent {2}399 Apr 27 07:19 SOUL\.md$/),
      );
    });

    it('should expose VFS commands through agent space fs', async () => {
      mockTrpcClient.agentDocument.listDocumentsByPath.query.mockResolvedValue([]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'ls',
        '--agent-id',
        'a1',
        'agent:/notes',
      ]);

      expect(mockTrpcClient.agentDocument.listDocumentsByPath.query).toHaveBeenCalledWith({
        agentId: 'a1',
        cursor: undefined,
        limit: undefined,
        path: './notes',
        topicId: undefined,
      });
    });

    it('should collect tree traversal warnings instead of failing the whole tree', async () => {
      mockTrpcClient.agentDocument.listDocumentsByPath.query
        .mockResolvedValueOnce([
          {
            mode: 8,
            name: 'builtin',
            path: './lobe/skills/builtin',
            type: 'directory',
          },
        ])
        .mockRejectedValueOnce(new Error('Failed to list builtin skills'));

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'tree',
        '--agent-id',
        'a1',
        'agent:/lobe/skills',
      ]);

      expect(mockTrpcClient.agentDocument.listDocumentsByPath.query).toHaveBeenNthCalledWith(1, {
        agentId: 'a1',
        path: './lobe/skills',
        topicId: undefined,
      });
      expect(mockTrpcClient.agentDocument.listDocumentsByPath.query).toHaveBeenNthCalledWith(2, {
        agentId: 'a1',
        path: './lobe/skills/builtin',
        topicId: undefined,
      });
      expect(log.warn).toHaveBeenCalledWith('./lobe/skills/builtin: Failed to list builtin skills');
    });

    it('should read SKILL.md when cat targets a skill directory alias', async () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      mockTrpcClient.agentDocument.statDocumentByPath.query.mockResolvedValue({
        content: '# Writer',
        mode: 2,
        mount: { driver: 'skills', namespace: 'builtin', source: 'builtin' },
        name: 'SKILL.md',
        path: './lobe/skills/builtin/skills/writer/SKILL.md',
        type: 'file',
      });
      mockTrpcClient.agentDocument.readDocumentByPath.query.mockResolvedValue({
        content: '# Writer',
        contentType: 'text/markdown',
        path: './lobe/skills/builtin/skills/writer/SKILL.md',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'cat',
        '--agent-id',
        'a1',
        'builtin:/writer',
      ]);

      expect(mockTrpcClient.agentDocument.statDocumentByPath.query).toHaveBeenCalledWith({
        agentId: 'a1',
        path: './lobe/skills/builtin/skills/writer/SKILL.md',
        topicId: undefined,
      });
      expect(mockTrpcClient.agentDocument.readDocumentByPath.query).toHaveBeenCalledWith({
        agentId: 'a1',
        path: './lobe/skills/builtin/skills/writer/SKILL.md',
        topicId: undefined,
      });
      expect(stdoutSpy).toHaveBeenCalledWith('# Writer');
      stdoutSpy.mockRestore();
    });

    it('should create a writable skill through touch when the path does not exist', async () => {
      mockTrpcClient.agentDocument.statDocumentByPath.query.mockRejectedValue({
        data: { code: 'NOT_FOUND' },
      });
      mockTrpcClient.agentDocument.writeDocumentByPath.mutate.mockResolvedValue({
        path: './lobe/skills/agent/skills/writer/SKILL.md',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'touch',
        '--agent-id',
        'a1',
        'skills:/writer',
        '--content',
        '# Writer',
      ]);

      expect(mockTrpcClient.agentDocument.writeDocumentByPath.mutate).toHaveBeenCalledWith({
        agentId: 'a1',
        content: '# Writer',
        createMode: 'if-missing',
        path: './lobe/skills/agent/skills/writer',
        topicId: undefined,
      });
    });

    it('should read write content from stdin when no content option is provided', async () => {
      const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
      mockReadStdinText.mockResolvedValue('# Piped Content');
      mockTrpcClient.agentDocument.statDocumentByPath.query.mockRejectedValue({
        data: { code: 'NOT_FOUND' },
      });
      mockTrpcClient.agentDocument.writeDocumentByPath.mutate.mockResolvedValue({
        path: './notes/piped.md',
      });

      try {
        const program = createProgram();
        await program.parseAsync([
          'node',
          'test',
          'agent',
          'space',
          'fs',
          'write',
          '--agent-id',
          'a1',
          'agent:/notes/piped.md',
        ]);

        expect(mockReadStdinText).toHaveBeenCalledWith(process.stdin);
        expect(mockTrpcClient.agentDocument.writeDocumentByPath.mutate).toHaveBeenCalledWith({
          agentId: 'a1',
          content: '# Piped Content',
          createMode: 'if-missing',
          path: './notes/piped.md',
          topicId: undefined,
        });
      } finally {
        if (stdinDescriptor) {
          Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
        }
      }
    });

    it('should create directories through the generic mkdir path API', async () => {
      mockTrpcClient.agentDocument.mkdirDocumentByPath.mutate.mockResolvedValue({
        path: './notes/archive',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'mkdir',
        '--agent-id',
        'a1',
        '--parents',
        'agent:/notes/archive',
      ]);

      expect(mockTrpcClient.agentDocument.mkdirDocumentByPath.mutate).toHaveBeenCalledWith({
        agentId: 'a1',
        path: './notes/archive',
        recursive: true,
        topicId: undefined,
      });
    });

    it('should stat unified root paths', async () => {
      mockTrpcClient.agentDocument.statDocumentByPath.query.mockResolvedValue({
        mode: 8,
        name: 'lobe',
        path: './lobe',
        type: 'directory',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'stat',
        '--agent-id',
        'a1',
        'agent:/lobe',
        '--json',
      ]);

      expect(mockTrpcClient.agentDocument.statDocumentByPath.query).toHaveBeenCalledWith({
        agentId: 'a1',
        path: './lobe',
        topicId: undefined,
      });
    });

    it('should copy paths through the generic copyDocumentByPath API', async () => {
      mockTrpcClient.agentDocument.copyDocumentByPath.mutate.mockResolvedValue({
        path: './notes/published.md',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'cp',
        '--agent-id',
        'a1',
        '--force',
        'agent:/notes/draft.md',
        'agent:/notes/published.md',
      ]);

      expect(mockTrpcClient.agentDocument.copyDocumentByPath.mutate).toHaveBeenCalledWith({
        agentId: 'a1',
        force: true,
        fromPath: './notes/draft.md',
        toPath: './notes/published.md',
        topicId: undefined,
      });
    });

    it('should rename paths through the generic renameDocumentByPath API', async () => {
      mockTrpcClient.agentDocument.renameDocumentByPath.mutate.mockResolvedValue({
        path: './notes/final.md',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'mv',
        '--agent-id',
        'a1',
        'agent:/notes/draft.md',
        'agent:/notes/final.md',
      ]);

      expect(mockTrpcClient.agentDocument.renameDocumentByPath.mutate).toHaveBeenCalledWith({
        agentId: 'a1',
        force: undefined,
        fromPath: './notes/draft.md',
        toPath: './notes/final.md',
        topicId: undefined,
      });
    });

    it('should soft-delete paths through the generic deleteDocumentByPath API', async () => {
      mockTrpcClient.agentDocument.deleteDocumentByPath.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'rm',
        '--agent-id',
        'a1',
        '--yes',
        '--recursive',
        'agent:/notes',
      ]);

      expect(mockTrpcClient.agentDocument.deleteDocumentByPath.mutate).toHaveBeenCalledWith({
        agentId: 'a1',
        force: undefined,
        path: './notes',
        recursive: true,
        topicId: undefined,
      });
    });

    it('should list trash through the generic trash path API', async () => {
      mockTrpcClient.agentDocument.listTrashDocumentsByPath.query.mockResolvedValue([
        { path: './notes/deleted.md' },
      ]);

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'trash',
        'ls',
        '--agent-id',
        'a1',
        'agent:/notes',
      ]);

      expect(mockTrpcClient.agentDocument.listTrashDocumentsByPath.query).toHaveBeenCalledWith({
        agentId: 'a1',
        path: './notes',
        topicId: undefined,
      });
      expect(consoleSpy).toHaveBeenCalledWith('agent:/notes/deleted.md');
    });

    it('should restore trash entries through the generic trash restore API', async () => {
      mockTrpcClient.agentDocument.restoreDocumentFromTrashByPath.mutate.mockResolvedValue({
        path: './notes/deleted.md',
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'trash',
        'restore',
        '--agent-id',
        'a1',
        'agent:/notes/deleted.md',
      ]);

      expect(
        mockTrpcClient.agentDocument.restoreDocumentFromTrashByPath.mutate,
      ).toHaveBeenCalledWith({
        agentId: 'a1',
        path: './notes/deleted.md',
        topicId: undefined,
      });
    });

    it('should permanently delete trash entries through the generic trash rm API', async () => {
      mockTrpcClient.agentDocument.deleteDocumentPermanentlyByPath.mutate.mockResolvedValue({});

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'agent',
        'space',
        'fs',
        'trash',
        'rm',
        '--agent-id',
        'a1',
        '--yes',
        '--force',
        'agent:/notes/deleted.md',
      ]);

      expect(
        mockTrpcClient.agentDocument.deleteDocumentPermanentlyByPath.mutate,
      ).toHaveBeenCalledWith({
        agentId: 'a1',
        force: true,
        path: './notes/deleted.md',
        recursive: undefined,
        topicId: undefined,
      });
    });
  });
});
