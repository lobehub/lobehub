import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const { mockMessageCreate, mockCreateOperation, mockUploadFromUrl } = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockUploadFromUrl: vi.fn(),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue({
      chatConfig: {},
      files: [],
      id: 'agent-1',
      knowledgeBases: [],
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helpful assistant',
    }),
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue({
      chatConfig: {},
      files: [],
      id: 'agent-1',
      knowledgeBases: [],
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helpful assistant',
    }),
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: mockCreateOperation,
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/klavis', () => ({
  KlavisService: vi.fn().mockImplementation(() => ({
    getKlavisManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    uploadFromUrl: mockUploadFromUrl,
  })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/toolExecution/deviceProxy', () => ({
  deviceProxy: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        abilities: { functionCall: true, video: false, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
    ],
  };
});

describe('AiAgentService.execAgent - file upload handling', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('when files are provided', () => {
    it('should upload files to S3 and pass fileIds to messageModel.create', async () => {
      mockUploadFromUrl.mockResolvedValue({
        fileId: 'file-abc',
        key: 'files/test-user-id/xxx/photo.png',
        url: 'https://app.lobehub.com/f/file-abc',
      });

      await service.execAgent({
        agentId: 'agent-1',
        files: [
          {
            mimeType: 'image/png',
            name: 'photo.png',
            size: 12345,
            url: 'https://cdn.discordapp.com/attachments/123/456/photo.png',
          },
        ],
        prompt: 'What is in this image?',
      });

      // Verify uploadFromUrl was called with the external URL
      expect(mockUploadFromUrl).toHaveBeenCalledWith(
        'https://cdn.discordapp.com/attachments/123/456/photo.png',
        expect.stringContaining('photo.png'),
      );

      // Verify messageModel.create was called with files
      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toEqual(['file-abc']);
    });

    it('should include imageList in initialMessages for vision models', async () => {
      mockUploadFromUrl.mockResolvedValue({
        fileId: 'file-img',
        key: 'files/test-user-id/xxx/screenshot.jpg',
        url: 'https://app.lobehub.com/f/file-img',
      });

      await service.execAgent({
        agentId: 'agent-1',
        files: [
          {
            mimeType: 'image/jpeg',
            name: 'screenshot.jpg',
            url: 'https://cdn.discordapp.com/attachments/123/456/screenshot.jpg',
          },
        ],
        prompt: 'Describe this screenshot',
      });

      // Verify createOperation received initialMessages with imageList on user message
      expect(mockCreateOperation).toHaveBeenCalled();
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      expect(lastMessage).toMatchObject({
        content: 'Describe this screenshot',
        role: 'user',
      });
      expect(lastMessage.imageList).toEqual([
        {
          alt: 'screenshot.jpg',
          id: 'file-img',
          url: 'https://app.lobehub.com/f/file-img',
        },
      ]);
    });

    it('should not include imageList for non-image files', async () => {
      mockUploadFromUrl.mockResolvedValue({
        fileId: 'file-pdf',
        key: 'files/test-user-id/xxx/doc.pdf',
        url: 'https://app.lobehub.com/f/file-pdf',
      });

      await service.execAgent({
        agentId: 'agent-1',
        files: [
          {
            mimeType: 'application/pdf',
            name: 'doc.pdf',
            url: 'https://cdn.discordapp.com/attachments/123/456/doc.pdf',
          },
        ],
        prompt: 'Summarize this document',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      expect(lastMessage.imageList).toBeUndefined();
    });
  });

  describe('when no files are provided', () => {
    it('should not call uploadFromUrl', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Hello',
      });

      expect(mockUploadFromUrl).not.toHaveBeenCalled();

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toBeUndefined();
    });
  });

  describe('when file upload fails', () => {
    it('should continue execution without the failed file', async () => {
      mockUploadFromUrl.mockRejectedValue(new Error('Download failed'));

      await service.execAgent({
        agentId: 'agent-1',
        files: [
          {
            mimeType: 'image/png',
            name: 'broken.png',
            url: 'https://expired-cdn.example.com/broken.png',
          },
        ],
        prompt: 'What is this?',
      });

      // Should still create message and operation (without files)
      expect(mockCreateOperation).toHaveBeenCalled();

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      // files array is empty since upload failed, so should be undefined-ish
      expect(userMessageCall![0].files).toEqual([]);
    });
  });
});
