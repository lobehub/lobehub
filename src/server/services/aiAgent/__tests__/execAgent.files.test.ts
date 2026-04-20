import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockMessageCreate,
  mockCreateOperation,
  mockIngestAttachment,
  mockParseFile,
  mockFindByIds,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockFindByIds: vi.fn(),
  mockIngestAttachment: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockParseFile: vi.fn(),
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
    queryAgents: vi.fn().mockResolvedValue([]),
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

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn().mockImplementation(() => ({
    findByIds: mockFindByIds,
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
    getFullFileUrl: vi
      .fn()
      .mockImplementation((key: string) => Promise.resolve(`https://s3.example.com/${key}`)),
  })),
}));

vi.mock('../ingestAttachment', () => ({
  ingestAttachment: mockIngestAttachment,
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn().mockImplementation(() => ({
    parseFile: mockParseFile,
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
    mockParseFile.mockResolvedValue({ content: '' });

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('when files are provided', () => {
    it('should upload files to S3 and pass fileIds to messageModel.create', async () => {
      mockIngestAttachment.mockResolvedValue({
        fileId: 'file-abc',
        isImage: true,
        isVideo: false,
        key: 'files/test-user-id/xxx/photo.png',
        resolvedUrl: 'https://s3.example.com/files/test-user-id/xxx/photo.png',
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

      // Verify ingestAttachment was called
      expect(mockIngestAttachment).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'photo.png', mimeType: 'image/png' }),
        expect.any(Object),
        'test-user-id',
      );

      // Verify messageModel.create was called with files
      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toEqual(['file-abc']);
    });

    it('should include imageList in initialMessages for vision models', async () => {
      mockIngestAttachment.mockResolvedValue({
        fileId: 'file-img',
        isImage: true,
        isVideo: false,
        key: 'files/test-user-id/xxx/screenshot.jpg',
        resolvedUrl: 'https://s3.example.com/files/test-user-id/xxx/screenshot.jpg',
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
          url: 'https://s3.example.com/files/test-user-id/xxx/screenshot.jpg',
        },
      ]);
    });

    it('should route videos to videoList instead of fileList', async () => {
      mockIngestAttachment.mockResolvedValue({
        fileId: 'file-vid',
        isImage: false,
        isVideo: true,
        key: 'files/test-user-id/xxx/clip.mp4',
        resolvedUrl: 'https://s3.example.com/files/test-user-id/xxx/clip.mp4',
      });

      await service.execAgent({
        agentId: 'agent-1',
        files: [
          {
            mimeType: 'video/mp4',
            name: 'clip.mp4',
            size: 67_890,
            url: 'https://cdn.discordapp.com/attachments/123/456/clip.mp4',
          },
        ],
        prompt: 'Describe this video',
      });

      // parseFile must NOT be invoked for videos — there is no document content
      // to extract, only the URL gets passed to video-capable models.
      expect(mockParseFile).not.toHaveBeenCalled();

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      // Video should land in videoList, not imageList or fileList
      expect(lastMessage.imageList).toBeUndefined();
      expect(lastMessage.fileList).toBeUndefined();
      expect(lastMessage.videoList).toEqual([
        {
          alt: 'clip.mp4',
          id: 'file-vid',
          url: 'https://s3.example.com/files/test-user-id/xxx/clip.mp4',
        },
      ]);

      // The fileId is still tracked on the user message record
      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toEqual(['file-vid']);
    });

    it('should parse non-image files and surface them via fileList for the LLM', async () => {
      mockIngestAttachment.mockResolvedValue({
        fileId: 'file-pdf',
        isImage: false,
        isVideo: false,
        key: 'files/test-user-id/xxx/doc.pdf',
        resolvedUrl: '',
      });
      mockParseFile.mockResolvedValue({ content: 'parsed pdf body text' });

      await service.execAgent({
        agentId: 'agent-1',
        files: [
          {
            mimeType: 'application/pdf',
            name: 'doc.pdf',
            size: 4096,
            url: 'https://cdn.discordapp.com/attachments/123/456/doc.pdf',
          },
        ],
        prompt: 'Summarize this document',
      });

      // DocumentService.parseFile must be invoked so the documents table is
      // populated and history queries can resurface the same content later.
      expect(mockParseFile).toHaveBeenCalledWith('file-pdf');

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      // imageList stays undefined for a non-image file …
      expect(lastMessage.imageList).toBeUndefined();
      // … but fileList is now populated so MessageContentProcessor can inject
      // the parsed content via filesPrompts() XML.
      expect(lastMessage.fileList).toEqual([
        {
          content: 'parsed pdf body text',
          fileType: 'application/pdf',
          id: 'file-pdf',
          name: 'doc.pdf',
          size: 4096,
          url: '',
        },
      ]);
    });

    it('continues with empty content when parseFile fails (e.g. binary file)', async () => {
      mockIngestAttachment.mockResolvedValue({
        fileId: 'file-bin',
        isImage: false,
        isVideo: false,
        key: 'files/test-user-id/xxx/blob.bin',
        resolvedUrl: '',
      });
      mockParseFile.mockRejectedValue(new Error('unsupported binary'));

      await service.execAgent({
        agentId: 'agent-1',
        files: [
          {
            mimeType: 'application/octet-stream',
            name: 'blob.bin',
            size: 10,
            url: 'https://cdn.example/blob.bin',
          },
        ],
        prompt: 'What is in this?',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      expect(lastMessage.fileList).toEqual([
        {
          content: undefined,
          fileType: 'application/octet-stream',
          id: 'file-bin',
          name: 'blob.bin',
          size: 10,
          url: '',
        },
      ]);
    });
  });

  describe('when no files are provided', () => {
    it('should not call uploadFromUrl', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Hello',
      });

      expect(mockIngestAttachment).not.toHaveBeenCalled();

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toBeUndefined();
    });
  });

  describe('when file upload fails', () => {
    it('should continue execution without the failed file', async () => {
      mockIngestAttachment.mockRejectedValue(new Error('Download failed'));

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

  // ─── Already-uploaded attachments (SPA Gateway mode) ───
  describe('when fileIds are provided (already-uploaded attachments)', () => {
    it('resolves image fileIds into imageList with full URLs and attaches them to the user message', async () => {
      mockFindByIds.mockResolvedValue([
        {
          id: 'file-img-1',
          fileType: 'image/png',
          name: 'photo.png',
          size: 2048,
          url: 'files/test-user-id/xxx/photo.png',
        },
      ]);

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-img-1'],
        prompt: 'What is in this image?',
      });

      expect(mockFindByIds).toHaveBeenCalledWith(['file-img-1']);

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toEqual(['file-img-1']);

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      expect(lastMessage.imageList).toEqual([
        {
          alt: 'photo.png',
          id: 'file-img-1',
          url: 'https://s3.example.com/files/test-user-id/xxx/photo.png',
        },
      ]);
      expect(lastMessage.videoList).toBeUndefined();
      expect(lastMessage.fileList).toBeUndefined();
      // parseFile is for documents only; image resolution must skip it
      expect(mockParseFile).not.toHaveBeenCalled();
    });

    it('parses document fileIds and populates fileList content', async () => {
      mockFindByIds.mockResolvedValue([
        {
          id: 'file-pdf-1',
          fileType: 'application/pdf',
          name: 'doc.pdf',
          size: 4096,
          url: 'files/test-user-id/xxx/doc.pdf',
        },
      ]);
      mockParseFile.mockResolvedValue({ content: 'parsed pdf body text' });

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-pdf-1'],
        prompt: 'Summarize this document',
      });

      expect(mockParseFile).toHaveBeenCalledWith('file-pdf-1');

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      expect(lastMessage.imageList).toBeUndefined();
      expect(lastMessage.fileList).toEqual([
        {
          content: 'parsed pdf body text',
          fileType: 'application/pdf',
          id: 'file-pdf-1',
          name: 'doc.pdf',
          size: 4096,
          url: 'https://s3.example.com/files/test-user-id/xxx/doc.pdf',
        },
      ]);
    });

    it('routes video fileIds into videoList (not imageList / fileList)', async () => {
      mockFindByIds.mockResolvedValue([
        {
          id: 'file-vid-1',
          fileType: 'video/mp4',
          name: 'clip.mp4',
          size: 67_890,
          url: 'files/test-user-id/xxx/clip.mp4',
        },
      ]);

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-vid-1'],
        prompt: 'Describe this clip',
      });

      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);

      expect(lastMessage.imageList).toBeUndefined();
      expect(lastMessage.fileList).toBeUndefined();
      expect(lastMessage.videoList).toEqual([
        {
          alt: 'clip.mp4',
          id: 'file-vid-1',
          url: 'https://s3.example.com/files/test-user-id/xxx/clip.mp4',
        },
      ]);
      expect(mockParseFile).not.toHaveBeenCalled();
    });

    it('preserves the caller-provided ordering of fileIds across classifications', async () => {
      // DB often returns rows in different order than queried; we must follow caller order.
      mockFindByIds.mockResolvedValue([
        {
          id: 'file-img-1',
          fileType: 'image/png',
          name: 'a.png',
          size: 1,
          url: 'a.png',
        },
        {
          id: 'file-pdf-1',
          fileType: 'application/pdf',
          name: 'b.pdf',
          size: 2,
          url: 'b.pdf',
        },
      ]);
      mockParseFile.mockResolvedValue({ content: 'b-content' });

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-pdf-1', 'file-img-1'],
        prompt: 'Mix of files',
      });

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      // Caller order preserved on the stored message relation.
      expect(userMessageCall![0].files).toEqual(['file-pdf-1', 'file-img-1']);
    });

    it('skips missing file records with a warning instead of failing', async () => {
      // Only one of the two requested IDs exists.
      mockFindByIds.mockResolvedValue([
        {
          id: 'file-img-1',
          fileType: 'image/png',
          name: 'ok.png',
          size: 1,
          url: 'ok.png',
        },
      ]);

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-img-1', 'file-missing'],
        prompt: 'Look at the good one',
      });

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toEqual(['file-img-1']);

      // Agent still runs end-to-end.
      expect(mockCreateOperation).toHaveBeenCalled();
    });

    it('deduplicates repeated fileIds before inserting the messages_files link', async () => {
      // messages_files has a composite PK on (file_id, message_id). Duplicate
      // fileIds would cause a constraint violation and abort the whole send.
      mockFindByIds.mockResolvedValue([
        {
          id: 'file-img-1',
          fileType: 'image/png',
          name: 'photo.png',
          size: 1,
          url: 'photo.png',
        },
      ]);

      await service.execAgent({
        agentId: 'agent-1',
        fileIds: ['file-img-1', 'file-img-1', 'file-img-1'],
        prompt: 'Triple duplicate',
      });

      // FileModel.findByIds sees deduped input (cheaper query)
      expect(mockFindByIds).toHaveBeenCalledWith(['file-img-1']);

      // Only one link row will be inserted
      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toEqual(['file-img-1']);

      // And imageList only contains the image once (no duplicate rendering)
      const createOpArgs = mockCreateOperation.mock.calls[0][0];
      const lastMessage = createOpArgs.initialMessages.at(-1);
      expect(lastMessage.imageList).toHaveLength(1);
    });

    it('no-ops cleanly when fileIds is an empty array', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        fileIds: [],
        prompt: 'Hello',
      });

      expect(mockFindByIds).not.toHaveBeenCalled();
      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      expect(userMessageCall![0].files).toBeUndefined();
    });
  });
});
