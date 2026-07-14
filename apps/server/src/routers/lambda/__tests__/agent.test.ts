// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INBOX_SESSION_ID } from '@/const/session';
import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { SessionModel } from '@/database/models/session';
import { TaskModel } from '@/database/models/task';
import { UserModel } from '@/database/models/user';
import { AgentService } from '@/server/services/agent';
import { EditLockService } from '@/server/services/editLock';
import { publishResourceEvent } from '@/server/services/resourceEvents';
import { hasWorkspaceScopedPermission } from '@/server/services/workspacePermission';
import { KnowledgeType } from '@/types/knowledgeBase';

import { agentRouter } from '../agent';

vi.mock('@/server/services/resourceEvents', () => ({ publishResourceEvent: vi.fn() }));

const publishResourceEventMock = vi.mocked(publishResourceEvent);

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

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(),
}));

vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: vi.fn(),
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

vi.mock('@/server/services/workspacePermission', () => ({
  hasWorkspaceScopedPermission: vi.fn(),
}));

describe('agentRouter', () => {
  const userId = 'testUserId';
  let mockCtx: any;
  let agentModelMock: any;
  let taskModelMock: any;
  let chatGroupModelMock: any;
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
      getAgentVisibility: vi.fn().mockResolvedValue(null),
      toggleFile: vi.fn(),
      toggleKnowledgeBase: vi.fn(),
      update: vi.fn(),
    };
    vi.mocked(AgentModel).mockImplementation(() => agentModelMock);

    taskModelMock = {
      countTasksBlockingAgentDemotion: vi.fn().mockResolvedValue(0),
    };
    vi.mocked(TaskModel).mockImplementation(() => taskModelMock);

    chatGroupModelMock = {
      countGroupsBlockingAgentDemotion: vi.fn().mockResolvedValue(0),
    };
    vi.mocked(ChatGroupModel).mockImplementation(() => chatGroupModelMock);

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
          ownerUserId: undefined,
          type: KnowledgeType.File,
          visibility: undefined,
        },
        {
          enabled: false,
          fileType: 'pdf',
          id: 'file2',
          name: 'File 2',
          ownerUserId: undefined,
          type: KnowledgeType.File,
          visibility: undefined,
        },
        {
          avatar: 'avatar1',
          description: 'desc 1',
          enabled: true,
          id: 'kb1',
          name: 'KB 1',
          ownerUserId: undefined,
          type: KnowledgeType.KnowledgeBase,
          visibility: undefined,
        },
        {
          avatar: 'avatar2',
          description: 'desc 2',
          enabled: false,
          id: 'kb2',
          name: 'KB 2',
          ownerUserId: undefined,
          type: KnowledgeType.KnowledgeBase,
          visibility: undefined,
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

  describe('updateAgentPinned', () => {
    it('should pin an agent', async () => {
      const mockInput = {
        id: 'agent1',
        pinned: true,
      };

      const caller = agentRouter.createCaller(mockCtx);
      await caller.updateAgentPinned(mockInput);

      expect(agentModelMock.update).toHaveBeenCalledWith(mockInput.id, { pinned: true });
    });

    it('should unpin an agent', async () => {
      const mockInput = {
        id: 'agent1',
        pinned: false,
      };

      const caller = agentRouter.createCaller(mockCtx);
      await caller.updateAgentPinned(mockInput);

      expect(agentModelMock.update).toHaveBeenCalledWith(mockInput.id, { pinned: false });
    });
  });

  describe('setAgentVisibility', () => {
    const wsCtx = () => ({ ...mockCtx, workspaceId: 'ws-1' });

    beforeEach(() => {
      agentModelMock.getAgentVisibilityMeta = vi.fn().mockResolvedValue({
        slug: null,
        userId,
        visibility: 'public',
      });
      agentModelMock.setVisibility = vi.fn().mockResolvedValue({ id: 'agent-1' });
    });

    it('rejects demotion while workspace tasks still depend on the agent', async () => {
      taskModelMock.countTasksBlockingAgentDemotion.mockResolvedValue(2);

      const caller = agentRouter.createCaller(wsCtx());

      await expect(
        caller.setAgentVisibility({ id: 'agent-1', visibility: 'private' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      // Compared against the agent owner (meta.userId), not just the caller.
      expect(taskModelMock.countTasksBlockingAgentDemotion).toHaveBeenCalledWith('agent-1', userId);
      expect(agentModelMock.setVisibility).not.toHaveBeenCalled();
    });

    it('allows demotion when no task depends on the agent', async () => {
      taskModelMock.countTasksBlockingAgentDemotion.mockResolvedValue(0);

      const caller = agentRouter.createCaller(wsCtx());
      const result = await caller.setAgentVisibility({ id: 'agent-1', visibility: 'private' });

      expect(result).toEqual({ success: true });
      expect(agentModelMock.setVisibility).toHaveBeenCalledWith('agent-1', 'private');
    });

    it('rejects demotion while the agent supervises group chats visible to others (LOBE-11772)', async () => {
      chatGroupModelMock.countGroupsBlockingAgentDemotion.mockResolvedValue(1);

      const caller = agentRouter.createCaller(wsCtx());

      await expect(
        caller.setAgentVisibility({ id: 'agent-1', visibility: 'private' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      // Compared against the agent owner (meta.userId), not just the caller.
      expect(chatGroupModelMock.countGroupsBlockingAgentDemotion).toHaveBeenCalledWith(
        'agent-1',
        userId,
      );
      expect(agentModelMock.setVisibility).not.toHaveBeenCalled();
    });

    it('rejects demotion of another member agent even for a workspace owner (LOBE-11760)', async () => {
      agentModelMock.getAgentVisibilityMeta.mockResolvedValue({
        slug: null,
        userId: 'other-member',
        visibility: 'public',
      });

      const caller = agentRouter.createCaller(wsCtx());

      await expect(
        caller.setAgentVisibility({ id: 'agent-1', visibility: 'private' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      // Creator-only: rejected before the owner-permission lookup even runs.
      expect(hasWorkspaceScopedPermission).not.toHaveBeenCalled();
      expect(agentModelMock.setVisibility).not.toHaveBeenCalled();
    });

    it('still allows a workspace owner to promote another member agent', async () => {
      agentModelMock.getAgentVisibilityMeta.mockResolvedValue({
        slug: null,
        userId: 'other-member',
        visibility: 'private',
      });
      vi.mocked(hasWorkspaceScopedPermission).mockResolvedValue(true);

      const caller = agentRouter.createCaller(wsCtx());
      const result = await caller.setAgentVisibility({ id: 'agent-1', visibility: 'public' });

      expect(result).toEqual({ success: true });
      expect(agentModelMock.setVisibility).toHaveBeenCalledWith('agent-1', 'public');
    });

    it('rejects promotion of another member agent for a plain member', async () => {
      agentModelMock.getAgentVisibilityMeta.mockResolvedValue({
        slug: null,
        userId: 'other-member',
        visibility: 'private',
      });
      vi.mocked(hasWorkspaceScopedPermission).mockResolvedValue(false);

      const caller = agentRouter.createCaller(wsCtx());

      await expect(
        caller.setAgentVisibility({ id: 'agent-1', visibility: 'public' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(agentModelMock.setVisibility).not.toHaveBeenCalled();
    });

    it('does not run the public-task guard on promotion', async () => {
      agentModelMock.getAgentVisibilityMeta.mockResolvedValue({
        slug: null,
        userId,
        visibility: 'private',
      });

      const caller = agentRouter.createCaller(wsCtx());
      await caller.setAgentVisibility({ id: 'agent-1', visibility: 'public' });

      expect(taskModelMock.countTasksBlockingAgentDemotion).not.toHaveBeenCalled();
      expect(agentModelMock.setVisibility).toHaveBeenCalledWith('agent-1', 'public');
    });
  });

  describe('edit lock', () => {
    const wsCtx = () => ({ ...mockCtx, workspaceId: 'ws-1' });

    describe('updateAgentConfig write guard', () => {
      it('rejects the update when another member holds the lock', async () => {
        agentServiceMock.updateAgentConfig = vi.fn().mockResolvedValue({ id: 'agent-1' });
        vi.spyOn(EditLockService.prototype, 'getBlockingHolder').mockResolvedValue('other-user');

        const caller = agentRouter.createCaller(wsCtx());

        await expect(
          caller.updateAgentConfig({ agentId: 'agent-1', value: { systemRole: 'x' } }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(agentServiceMock.updateAgentConfig).not.toHaveBeenCalled();
      });

      it('allows the update when no other member holds the lock', async () => {
        agentServiceMock.updateAgentConfig = vi.fn().mockResolvedValue({ id: 'agent-1' });
        vi.spyOn(EditLockService.prototype, 'getBlockingHolder').mockResolvedValue(null);

        const caller = agentRouter.createCaller(wsCtx());
        await caller.updateAgentConfig({ agentId: 'agent-1', value: { systemRole: 'x' } });

        expect(agentServiceMock.updateAgentConfig).toHaveBeenCalledWith('agent-1', {
          systemRole: 'x',
        });
      });

      it('does not check the lock for personal (non-workspace) agents', async () => {
        agentServiceMock.updateAgentConfig = vi.fn().mockResolvedValue({ id: 'agent-1' });
        const guardSpy = vi.spyOn(EditLockService.prototype, 'getBlockingHolder');

        const caller = agentRouter.createCaller(mockCtx);
        await caller.updateAgentConfig({ agentId: 'agent-1', value: { systemRole: 'x' } });

        expect(guardSpy).not.toHaveBeenCalled();
        expect(agentServiceMock.updateAgentConfig).toHaveBeenCalled();
      });
    });

    describe('acquireAgentLock', () => {
      it('returns unlocked without touching the lock service for personal agents', async () => {
        const acquireSpy = vi.spyOn(EditLockService.prototype, 'acquire');

        const caller = agentRouter.createCaller(mockCtx);
        const result = await caller.acquireAgentLock({ agentId: 'agent-1' });

        expect(result).toEqual({ expiresAt: null, holderId: null, lockedByOther: false });
        expect(acquireSpy).not.toHaveBeenCalled();
      });

      it('broadcasts lock.changed on a holder edge (first claim)', async () => {
        vi.spyOn(EditLockService.prototype, 'getActiveHolder').mockResolvedValue(undefined);
        vi.spyOn(EditLockService.prototype, 'acquire').mockResolvedValue({
          expiresAt: new Date(),
          holderId: userId,
          lockedByOther: false,
          ownerId: null,
        });

        const caller = agentRouter.createCaller(wsCtx());
        await caller.acquireAgentLock({ agentId: 'agent-1' });

        expect(publishResourceEventMock).toHaveBeenCalledWith(
          { id: 'agent-1', type: 'agent' },
          expect.objectContaining({ data: { holderId: userId }, type: 'lock.changed' }),
        );
      });

      it('does NOT broadcast on a steady-state heartbeat (same holder)', async () => {
        vi.spyOn(EditLockService.prototype, 'getActiveHolder').mockResolvedValue(userId);
        vi.spyOn(EditLockService.prototype, 'acquire').mockResolvedValue({
          expiresAt: new Date(),
          holderId: userId,
          lockedByOther: false,
          ownerId: null,
        });

        const caller = agentRouter.createCaller(wsCtx());
        await caller.acquireAgentLock({ agentId: 'agent-1' });

        expect(publishResourceEventMock).not.toHaveBeenCalled();
      });
    });

    describe('getAgentLock', () => {
      it('reports another member as the holder', async () => {
        vi.spyOn(EditLockService.prototype, 'getActiveHolder').mockResolvedValue('other-user');

        const caller = agentRouter.createCaller(wsCtx());
        const result = await caller.getAgentLock({ agentId: 'agent-1' });

        expect(result).toEqual({ expiresAt: null, holderId: 'other-user', lockedByOther: true });
      });
    });

    describe('releaseAgentLock', () => {
      it('broadcasts unlocked only when it actually freed the lock', async () => {
        vi.spyOn(EditLockService.prototype, 'release').mockResolvedValue(true);

        const caller = agentRouter.createCaller(wsCtx());
        await caller.releaseAgentLock({ agentId: 'agent-1' });

        expect(publishResourceEventMock).toHaveBeenCalledWith(
          { id: 'agent-1', type: 'agent' },
          expect.objectContaining({ data: { holderId: null }, type: 'lock.changed' }),
        );
      });

      it('does NOT broadcast when the lease expired / was taken over', async () => {
        vi.spyOn(EditLockService.prototype, 'release').mockResolvedValue(false);

        const caller = agentRouter.createCaller(wsCtx());
        await caller.releaseAgentLock({ agentId: 'agent-1' });

        expect(publishResourceEventMock).not.toHaveBeenCalled();
      });
    });
  });
});
