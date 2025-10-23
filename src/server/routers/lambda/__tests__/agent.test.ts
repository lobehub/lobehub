// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INBOX_SESSION_ID } from '@/const/session';
import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { AgentModel } from '@/database/models/agent';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import { serverDB } from '@/database/server';
import { AgentService } from '@/server/services/agent';
import { KnowledgeType } from '@/types/knowledgeBase';

import { agentRouter } from '../agent';

vi.mock('@/database/models/user', () => ({
  UserModel: {
    findById: vi.fn(),
  },
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(),
}));

vi.mock('@/database/models/session', () => ({
  SessionModel: vi.fn(),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(),
}));

vi.mock('@/database/models/knowledgeBase', () => ({
  KnowledgeBaseModel: vi.fn(),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn(),
}));

describe('agentRouter', () => {
  const userId = 'testUserId';
  let mockCtx: any;
  let agentModelMock: any;
  let sessionModelMock: any;
  let fileModelMock: any;
  let knowledgeBaseModelMock: any;
  let agentServiceMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    agentModelMock = {
      createAgentFiles: vi.fn(),
      createAgentKnowledgeBase: vi.fn(),
      deleteAgentFile: vi.fn(),
      deleteAgentKnowledgeBase: vi.fn(),
      findBySessionId: vi.fn(),
      getAgentAssignedKnowledge: vi.fn(),
      toggleFile: vi.fn(),
      toggleKnowledgeBase: vi.fn(),
    };
    vi.mocked(AgentModel).mockImplementation(() => agentModelMock);

    sessionModelMock = {
      findByIdOrSlug: vi.fn(),
    };
    vi.mocked(SessionModel).mockImplementation(() => sessionModelMock);

    fileModelMock = {
      query: vi.fn(),
    };
    vi.mocked(FileModel).mockImplementation(() => fileModelMock);

    knowledgeBaseModelMock = {
      query: vi.fn(),
    };
    vi.mocked(KnowledgeBaseModel).mockImplementation(() => knowledgeBaseModelMock);

    agentServiceMock = {
      createInbox: vi.fn(),
    };
    vi.mocked(AgentService).mockImplementation(() => agentServiceMock);

    mockCtx = {
      userId,
      agentModel: agentModelMock,
      agentService: agentServiceMock,
      fileModel: fileModelMock,
      knowledgeBaseModel: knowledgeBaseModelMock,
      sessionModel: sessionModelMock,
    };
  });

  describe('getAgentConfig', () => {
    it('should return default config if user not found when getting inbox config', async () => {
      vi.mocked(UserModel.findById).mockResolvedValue(undefined);
      sessionModelMock.findByIdOrSlug.mockResolvedValue(undefined);

      const caller = agentRouter.createCaller(mockCtx);
      const result = await caller.getAgentConfig({ sessionId: INBOX_SESSION_ID });

      expect(result).toEqual(DEFAULT_AGENT_CONFIG);
    });

    it('should create inbox session if user exists but no inbox session', async () => {
      const mockUser = { id: userId };
      const mockSession = { id: 'inboxSessionId' };

      vi.mocked(UserModel.findById).mockResolvedValue(mockUser as any);
      sessionModelMock.findByIdOrSlug
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(mockSession);
      agentModelMock.findBySessionId.mockResolvedValue(DEFAULT_AGENT_CONFIG);

      const caller = agentRouter.createCaller(mockCtx);
      const result = await caller.getAgentConfig({ sessionId: INBOX_SESSION_ID });

      expect(agentServiceMock.createInbox).toHaveBeenCalled();
      expect(result).toEqual(DEFAULT_AGENT_CONFIG);
    });

    it('should find agent by session id if session exists', async () => {
      const mockSession = { id: 'session1' };
      sessionModelMock.findByIdOrSlug.mockResolvedValue(mockSession);
      agentModelMock.findBySessionId.mockResolvedValue(DEFAULT_AGENT_CONFIG);

      const caller = agentRouter.createCaller(mockCtx);
      const result = await caller.getAgentConfig({ sessionId: 'session1' });

      expect(agentModelMock.findBySessionId).toHaveBeenCalledWith('session1');
      expect(result).toEqual(DEFAULT_AGENT_CONFIG);
    });
  });

  describe('getKnowledgeBasesAndFiles', () => {
    it('should return combined knowledge bases and files', async () => {
      const mockFiles = [
        { id: 'file1', name: 'File 1', fileType: 'text' },
        { id: 'file2', name: 'File 2', fileType: 'pdf' },
      ];

      const mockKnowledgeBases = [
        { id: 'kb1', name: 'KB 1', description: 'desc 1', avatar: 'avatar1' },
        { id: 'kb2', name: 'KB 2', description: 'desc 2', avatar: 'avatar2' },
      ];

      const mockKnowledge = {
        files: [{ id: 'file1', enabled: true }],
        knowledgeBases: [{ id: 'kb1', enabled: true }],
      };

      fileModelMock.query.mockResolvedValue(mockFiles);
      knowledgeBaseModelMock.query.mockResolvedValue(mockKnowledgeBases);
      agentModelMock.getAgentAssignedKnowledge.mockResolvedValue(mockKnowledge);

      const caller = agentRouter.createCaller(mockCtx);
      const result = await caller.getKnowledgeBasesAndFiles({ agentId: 'agent1' });

      expect(result).toEqual([
        {
          enabled: true,
          fileType: 'text',
          id: 'file1',
          name: 'File 1',
          type: KnowledgeType.File,
        },
        {
          enabled: false,
          fileType: 'pdf',
          id: 'file2',
          name: 'File 2',
          type: KnowledgeType.File,
        },
        {
          avatar: 'avatar1',
          description: 'desc 1',
          enabled: true,
          id: 'kb1',
          name: 'KB 1',
          type: KnowledgeType.KnowledgeBase,
        },
        {
          avatar: 'avatar2',
          description: 'desc 2',
          enabled: false,
          id: 'kb2',
          name: 'KB 2',
          type: KnowledgeType.KnowledgeBase,
        },
      ]);
    });
  });

  describe('createAgentFiles', () => {
    it('should create agent files', async () => {
      const mockInput = {
        agentId: 'agent1',
        fileIds: ['file1', 'file2'],
        enabled: true,
      };

      const caller = agentRouter.createCaller(mockCtx);
      await caller.createAgentFiles(mockInput);

      expect(agentModelMock.createAgentFiles).toHaveBeenCalledWith(
        mockInput.agentId,
        mockInput.fileIds,
        mockInput.enabled,
      );
    });
  });

  describe('deleteAgentFile', () => {
    it('should delete agent file', async () => {
      const mockInput = {
        agentId: 'agent1',
        fileId: 'file1',
      };

      const caller = agentRouter.createCaller(mockCtx);
      await caller.deleteAgentFile(mockInput);

      expect(agentModelMock.deleteAgentFile).toHaveBeenCalledWith(
        mockInput.agentId,
        mockInput.fileId,
      );
    });
  });

  describe('toggleFile', () => {
    it('should toggle file', async () => {
      const mockInput = {
        agentId: 'agent1',
        fileId: 'file1',
        enabled: true,
      };

      const caller = agentRouter.createCaller(mockCtx);
      await caller.toggleFile(mockInput);

      expect(agentModelMock.toggleFile).toHaveBeenCalledWith(
        mockInput.agentId,
        mockInput.fileId,
        mockInput.enabled,
      );
    });
  });

  describe('createAgentKnowledgeBase', () => {
    it('should create agent knowledge base', async () => {
      const mockInput = {
        agentId: 'agent1',
        knowledgeBaseId: 'kb1',
        enabled: true,
      };

      const caller = agentRouter.createCaller(mockCtx);
      await caller.createAgentKnowledgeBase(mockInput);

      expect(agentModelMock.createAgentKnowledgeBase).toHaveBeenCalledWith(
        mockInput.agentId,
        mockInput.knowledgeBaseId,
        mockInput.enabled,
      );
    });
  });

  describe('deleteAgentKnowledgeBase', () => {
    it('should delete agent knowledge base', async () => {
      const mockInput = {
        agentId: 'agent1',
        knowledgeBaseId: 'kb1',
      };

      const caller = agentRouter.createCaller(mockCtx);
      await caller.deleteAgentKnowledgeBase(mockInput);

      expect(agentModelMock.deleteAgentKnowledgeBase).toHaveBeenCalledWith(
        mockInput.agentId,
        mockInput.knowledgeBaseId,
      );
    });
  });

  describe('toggleKnowledgeBase', () => {
    it('should toggle knowledge base', async () => {
      const mockInput = {
        agentId: 'agent1',
        knowledgeBaseId: 'kb1',
        enabled: true,
      };

      const caller = agentRouter.createCaller(mockCtx);
      await caller.toggleKnowledgeBase(mockInput);

      expect(agentModelMock.toggleKnowledgeBase).toHaveBeenCalledWith(
        mockInput.agentId,
        mockInput.knowledgeBaseId,
        mockInput.enabled,
      );
    });
  });
});
