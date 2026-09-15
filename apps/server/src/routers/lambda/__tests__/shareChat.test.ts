// @vitest-environment node
import type * as BusinessConst from '@lobechat/business-const';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as MessageModelModule from '@/database/models/message';
import { createContextInner } from '@/libs/trpc/lambda/context';

const mockServerDB = {
  transaction: vi.fn(async (fn: (trx: unknown) => Promise<unknown>) => fn({ trx: true })),
};
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return mockServerDB;
  }),
}));

// Pin the cloud-only capability open so the visitor procedures under test are
// reachable: ENABLE_BUSINESS_FEATURES is false in OSS builds, and the
// shareChatProcedure middleware (`_helpers/agentShareFeatureGate.ts`) would
// otherwise reject everything with FORBIDDEN before reaching any of the
// behavior these tests exercise. The "gate itself" is covered separately by
// `_helpers/__tests__/agentShareFeatureGate.test.ts` and the dedicated
// "visitor capability" describe block below.
const mocks = vi.hoisted(() => ({
  businessConst: { ENABLE_BUSINESS_FEATURES: true },
}));
vi.mock('@lobechat/business-const', async () => {
  const actual = await vi.importActual<typeof BusinessConst>('@lobechat/business-const');
  return {
    ...actual,
    // `packages/utils/src/apiKey.ts` reads this dynamically (`import * as
    // businessConst`), pulled in transitively via the unmocked
    // `createContextInner` -> `ApiKeyModel` chain below. `actual` here
    // resolves to the cloud override, which omits this key entirely (see
    // that file's own doc comment), so vitest's mock-export validation has
    // no own property to find unless it is listed explicitly.
    API_KEY_PREFIX: (actual as Record<string, unknown>).API_KEY_PREFIX,
    // A getter (not a static spread) so per-test mutation of
    // `mocks.businessConst.ENABLE_BUSINESS_FEATURES` is observed by every
    // subsequent read, including inside the already-imported gate helper.
    get ENABLE_BUSINESS_FEATURES() {
      return mocks.businessConst.ENABLE_BUSINESS_FEATURES;
    },
  };
});

const mockGetFeatureFlagsState = vi.fn();
vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: (...args: unknown[]) =>
    mockGetFeatureFlagsState(...args),
}));

const mockAccessCheck = vi.fn();
vi.mock('@/database/models/agentShare', () => ({
  AgentShareModel: { findByShareIdWithAccessCheck: (...args: any[]) => mockAccessCheck(...args) },
}));

const mockFindById = vi.fn();
const mockCountBySender = vi.fn();
const mockQueryBySender = vi.fn();
const mockIsRunningOperationAlive = vi.fn();
const TopicModelMock = vi.fn(function () {
  return {
    countBySender: mockCountBySender,
    findById: mockFindById,
    isRunningOperationAlive: mockIsRunningOperationAlive,
    queryBySender: mockQueryBySender,
  };
});
vi.mock('@/database/models/topic', () => ({
  TopicModel: TopicModelMock,
}));

const mockMessageCountByTopic = vi.fn();
const mockMessageQuery = vi.fn();
const mockMessageQueryForVisitor = vi.fn();
vi.mock('@/database/models/message', async (importOriginal) => {
  // Keep the real `sanitizeVisitorError` (rather than re-stubbing it) so the
  // startup-error regression below exercises the SAME projection shareChat
  // reuses in production — not a test-only stand-in that could silently
  // drift from it.
  const actual = await importOriginal<typeof MessageModelModule>();
  return {
    ...actual,
    MessageModel: vi.fn(function () {
      return {
        countByTopic: mockMessageCountByTopic,
        query: mockMessageQuery,
        queryForVisitor: mockMessageQueryForVisitor,
      };
    }),
  };
});

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(function () {
    return { getUserSettings: vi.fn().mockResolvedValue({}) };
  }),
}));

const mockFileFindByIds = vi.fn();
const mockFileFindById = vi.fn();
const mockFileCreate = vi.fn();
const mockFileDeleteUnreferenced = vi.fn();
const FileModelMock = vi.fn(function () {
  return {
    create: mockFileCreate,
    deleteUnreferenced: mockFileDeleteUnreferenced,
    findById: mockFileFindById,
    findByIds: mockFileFindByIds,
  };
});
vi.mock('@/database/models/file', () => ({
  FileModel: FileModelMock,
}));

const mockReserveUpload = vi.fn();
vi.mock('@/server/services/fileUploadReservation', () => ({
  reserveUpload: (...args: any[]) => mockReserveUpload(...args),
}));

const FileUploadModelMock = vi.fn(function () {
  return {};
});
vi.mock('@/database/models/fileUpload', () => ({
  FileUploadModel: FileUploadModelMock,
}));

const mockUploadTouchActive = vi.fn();
const mockUploadFindLatest = vi.fn();
const mockUploadRelease = vi.fn();
const mockUploadReleaseBestEffort = vi.fn();
const mockUploadFindLatestForUpdate = vi.fn();
const mockUploadSettle = vi.fn();
const FileUploadServiceMock = vi.fn(function () {
  return {
    findLatest: mockUploadFindLatest,
    model: {
      findLatestByPathnameForUpdate: mockUploadFindLatestForUpdate,
      settle: mockUploadSettle,
    },
    release: mockUploadRelease,
    releaseBestEffort: mockUploadReleaseBestEffort,
    touchActive: mockUploadTouchActive,
  };
});
vi.mock('@/server/services/fileUpload', () => ({
  FileUploadService: FileUploadServiceMock,
}));

const mockCreatePreSignedUrl = vi.fn();
vi.mock('@/server/modules/S3', () => ({
  FileS3: vi.fn(function () {
    return { createPreSignedUrl: mockCreatePreSignedUrl };
  }),
}));

vi.mock('@/config/db', () => ({
  serverDBEnv: { REMOVE_GLOBAL_FILE: true },
}));

const mockExecAgent = vi.fn();
const mockInterruptTask = vi.fn();
const AiAgentServiceMock = vi.fn(function () {
  return {
    execAgent: mockExecAgent,
    interruptTask: mockInterruptTask,
  };
});
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: AiAgentServiceMock,
}));

const mockGetFileAccessUrl = vi.fn();
const mockGetFileMetadata = vi.fn();
const mockDeleteStoredFile = vi.fn();
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {
      deleteFile: mockDeleteStoredFile,
      getFileAccessUrl: mockGetFileAccessUrl,
      getFileMetadata: mockGetFileMetadata,
    };
  }),
}));

const mockSpendGate = vi.fn();
vi.mock('@/business/server/agent-share/spendGate', () => ({
  checkAgentShareSpendAllowance: (...args: any[]) => mockSpendGate(...args),
}));

const mockSignUserJWT = vi.fn();
vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signUserJWT: (...args: any[]) => mockSignUserJWT(...args),
}));

const { shareChatRouter } = await import('../shareChat');

const VISITOR = 'visitor-1';
const OWNER = 'owner-1';

const share = {
  agentId: 'agt_share',
  ownerId: OWNER,
  shareConfig: {
    allowReadMemory: false,
    toolGrants: [],
    maxTopicsPerVisitor: 2,
    maxTurnsPerTopic: 3,
  },
  shareId: 'share-1',
  visibility: 'link',
};

const visitorTopic = {
  agentId: share.agentId,
  id: 'tpc_visitor',
  metadata: { runningOperation: { operationId: 'op-1' } },
  senderId: VISITOR,
};

const createCaller = async () =>
  shareChatRouter.createCaller(await createContextInner({ userId: VISITOR }));

describe('shareChatRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.businessConst.ENABLE_BUSINESS_FEATURES = true;
    mockGetFeatureFlagsState.mockResolvedValue({ enableAgentShare: true });
    mockAccessCheck.mockResolvedValue(share);
    mockFindById.mockResolvedValue(visitorTopic);
    mockIsRunningOperationAlive.mockResolvedValue(true);
    mockCountBySender.mockResolvedValue(0);
    mockQueryBySender.mockResolvedValue([]);
    mockMessageCountByTopic.mockResolvedValue(0);
    mockMessageQuery.mockResolvedValue([]);
    mockExecAgent.mockResolvedValue({ operationId: 'op-1', success: true });
    mockInterruptTask.mockResolvedValue({ operationId: 'op-1', success: true });
    mockSignUserJWT.mockResolvedValue('visitor-jwt');
    mockSpendGate.mockResolvedValue({ allowed: true });
    mockFileFindByIds.mockResolvedValue([]);
    mockFileFindById.mockResolvedValue(undefined);
    mockFileCreate.mockResolvedValue({ id: 'file-new' });
    mockFileDeleteUnreferenced.mockResolvedValue(undefined);
    mockReserveUpload.mockResolvedValue({ id: 'upload-1', size: 10 });
    mockCreatePreSignedUrl.mockResolvedValue('https://s3/put');
    mockUploadTouchActive.mockResolvedValue(undefined);
    mockUploadFindLatest.mockResolvedValue(undefined);
    mockUploadRelease.mockResolvedValue(true);
    mockUploadReleaseBestEffort.mockResolvedValue(undefined);
    mockUploadFindLatestForUpdate.mockResolvedValue(undefined);
    mockUploadSettle.mockResolvedValue(true);
    mockGetFileAccessUrl.mockResolvedValue('https://s3/get');
    mockGetFileMetadata.mockResolvedValue({ contentLength: 10 });
    mockDeleteStoredFile.mockResolvedValue(undefined);
  });

  describe('execAgent', () => {
    // The owner never uses the visitor chain, so this entry point demands the
    // same `link` visibility the per-step revalidation
    // (`AgentShareModel.isRunStillAuthorized`) demands — otherwise an owner
    // previewing their own private share could start a run its own step loop
    // would immediately abort.
    it('rejects a share that is not link-visible, even for the owner', async () => {
      mockAccessCheck.mockResolvedValue({ ...share, visibility: 'private' });
      const caller = await createCaller();

      await expect(caller.execAgent({ prompt: 'hi', shareId: 'share-1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    // The spend gate runs before ANY row is created, so a rejected run leaves
    // no orphan topic / placeholder assistant message behind.
    it('rejects the run when the spend gate vetoes it, before any topic lookup', async () => {
      mockSpendGate.mockResolvedValue({ allowed: false });
      const caller = await createCaller();

      await expect(caller.execAgent({ prompt: 'hi', shareId: 'share-1' })).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: 'ShareSpendLimitExceeded',
      });
      expect(mockCountBySender).not.toHaveBeenCalled();
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it('passes the creator, share and configured cap to the spend gate', async () => {
      mockAccessCheck.mockResolvedValue({
        ...share,
        shareConfig: { ...share.shareConfig, monthlySpendLimit: 25 },
      });
      const caller = await createCaller();

      await caller.execAgent({ prompt: 'hi', shareId: 'share-1' });

      expect(mockSpendGate).toHaveBeenCalledWith({
        agentId: share.agentId,
        monthlySpendLimit: 25,
        ownerUserId: OWNER,
        shareId: 'share-1',
        visitorUserId: VISITOR,
      });
    });

    it('rejects a new-topic run once the visitor topic cap is reached', async () => {
      mockCountBySender.mockResolvedValue(2);
      const caller = await createCaller();

      await expect(caller.execAgent({ prompt: 'hi', shareId: 'share-1' })).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: 'ShareTopicLimitExceeded',
      });
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it('rejects an existing-topic run once the turn cap is reached', async () => {
      mockMessageCountByTopic.mockResolvedValue(3);
      const caller = await createCaller();

      await expect(
        caller.execAgent({ prompt: 'hi', shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: 'ShareTurnLimitExceeded',
      });
      expect(mockMessageCountByTopic).toHaveBeenCalledWith({
        role: 'user',
        topicId: 'tpc_visitor',
      });
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it("fails closed when the topic is not the visitor's own share topic", async () => {
      mockFindById.mockResolvedValue({ ...visitorTopic, senderId: 'someone-else' });
      const caller = await createCaller();

      await expect(
        caller.execAgent({ prompt: 'hi', shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it('dispatches a creator-scoped run carrying the share gate', async () => {
      const caller = await createCaller();

      await expect(caller.execAgent({ prompt: 'hi', shareId: 'share-1' })).resolves.toMatchObject({
        operationId: 'op-1',
      });

      // Service runs as the CREATOR — the share's owner, never the visitor.
      expect(AiAgentServiceMock).toHaveBeenCalledWith(expect.anything(), OWNER, expect.any(Object));
      expect(mockExecAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          // Agent id comes from the share record, not client input.
          agentId: share.agentId,
          shareGate: {
            agentId: share.agentId,
            shareConfig: share.shareConfig,
            shareId: share.shareId,
            visitorUserId: VISITOR,
          },
        }),
      );
    });

    describe('attachments', () => {
      const fileIds = ['file-a', 'file-b'];
      const shareFile = (id: string, overrides: Record<string, unknown> = {}) => ({
        id,
        metadata: { agentShare: { shareId: share.shareId, visitorUserId: VISITOR } },
        source: 'agent_share',
        ...overrides,
      });

      it("forwards fileIds to the run after checking each one's share provenance in the CREATOR scope", async () => {
        mockFileFindByIds.mockResolvedValue(fileIds.map((id) => shareFile(id)));
        const caller = await createCaller();

        await caller.execAgent({ fileIds, prompt: 'look', shareId: 'share-1' });

        // Share uploads are creator-owned rows (`createFile`), so the lookup
        // runs as the creator; what proves they are THIS visitor's is the
        // provenance on each row, not the scope.
        expect(FileModelMock).toHaveBeenCalledWith(expect.anything(), OWNER);
        expect(mockFileFindByIds).toHaveBeenCalledWith(fileIds);
        expect(mockExecAgent).toHaveBeenCalledWith(expect.objectContaining({ fileIds }));
      });

      it("rejects with NOT_FOUND when any id is one of the creator's own files (no share provenance)", async () => {
        // A visitor naming an arbitrary id must not get the creator's own
        // document injected into the run. Fail closed on the whole request.
        mockFileFindByIds.mockResolvedValue([shareFile('file-a'), { id: 'file-b', source: null }]);
        const caller = await createCaller();

        await expect(
          caller.execAgent({ fileIds, prompt: 'look', shareId: 'share-1' }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'File not found' });
        expect(mockCountBySender).not.toHaveBeenCalled();
        expect(mockExecAgent).not.toHaveBeenCalled();
      });

      it("rejects another visitor's upload on the same share, and this visitor's upload on another share", async () => {
        const caller = await createCaller();

        mockFileFindByIds.mockResolvedValue([
          shareFile('file-a', {
            metadata: { agentShare: { shareId: share.shareId, visitorUserId: 'visitor-2' } },
          }),
        ]);
        await expect(
          caller.execAgent({ fileIds: ['file-a'], prompt: 'look', shareId: 'share-1' }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });

        mockFileFindByIds.mockResolvedValue([
          shareFile('file-a', {
            metadata: { agentShare: { shareId: 'share-other', visitorUserId: VISITOR } },
          }),
        ]);
        await expect(
          caller.execAgent({ fileIds: ['file-a'], prompt: 'look', shareId: 'share-1' }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        expect(mockExecAgent).not.toHaveBeenCalled();
      });

      it('accepts duplicate ids as long as each distinct id is owned', async () => {
        mockFileFindByIds.mockResolvedValue([shareFile('file-a')]);
        const caller = await createCaller();

        await expect(
          caller.execAgent({ fileIds: ['file-a', 'file-a'], prompt: 'look', shareId: 'share-1' }),
        ).resolves.toMatchObject({ operationId: 'op-1' });
        expect(mockFileFindByIds).toHaveBeenCalledWith(['file-a']);
      });

      it('skips the ownership lookup entirely when no fileIds are sent', async () => {
        const caller = await createCaller();

        await caller.execAgent({ prompt: 'hi', shareId: 'share-1' });

        expect(FileModelMock).not.toHaveBeenCalled();
      });

      it('rejects more than SHARE_VISITOR_MAX_FILES_PER_TURN ids at the schema, before any lookup', async () => {
        const caller = await createCaller();
        const tooMany = Array.from({ length: 11 }, (_, i) => `file-${i}`);

        await expect(
          caller.execAgent({ fileIds: tooMany, prompt: 'look', shareId: 'share-1' }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        expect(FileModelMock).not.toHaveBeenCalled();
        expect(mockExecAgent).not.toHaveBeenCalled();
      });
    });

    // Regression for Codex P1 (`shareChat.ts` prompt schema): a
    // direct RPC caller (bypassing any client-side textarea limit) could
    // previously submit an HTTP-infrastructure-limit-sized `prompt`, which
    // `AiAgentService.execAgent` would persist verbatim into the CREATOR's
    // messages before any topic/turn cap even runs (those gate request
    // COUNT, not per-request SIZE). The schema now rejects an oversized
    // prompt before any row is touched.
    it('rejects an oversized prompt before any DB row is touched', async () => {
      const caller = await createCaller();
      const oversizedPrompt = 'a'.repeat(20_001);

      await expect(
        caller.execAgent({ prompt: oversizedPrompt, shareId: 'share-1' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mockAccessCheck).not.toHaveBeenCalled();
      expect(mockExecAgent).not.toHaveBeenCalled();
    });

    it('accepts a prompt right at the size limit', async () => {
      const caller = await createCaller();
      const maxPrompt = 'a'.repeat(20_000);

      await expect(
        caller.execAgent({ prompt: maxPrompt, shareId: 'share-1' }),
      ).resolves.toMatchObject({ operationId: 'op-1' });
    });

    // Regression for Codex P2: a startup failure BEFORE Gateway
    // streaming begins (e.g. the queue/runtime backend returning a raw
    // diagnostic) must not reach the visitor verbatim — the run executes
    // under the CREATOR's identity, so `error.message` here can carry
    // provider/infra detail. `toVisitorSafeStartupError` must project it
    // through the same `sanitizeVisitorError` classification used elsewhere
    // in this branch, not echo it back raw.
    it('redacts a diagnostic startup failure instead of leaking it to the visitor', async () => {
      const diagnostic = new Error(
        'ECONNREFUSED connecting to internal-runtime-queue.prod.internal:6379 (provider=openai, apiKey=sk-***)',
      );
      mockExecAgent.mockRejectedValueOnce(diagnostic);
      const caller = await createCaller();

      const rejection = caller.execAgent({ prompt: 'hi', shareId: 'share-1' });
      await expect(rejection).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
      await rejection.catch((error: any) => {
        expect(error.message).not.toContain('internal-runtime-queue');
        expect(error.message).not.toContain('openai');
        expect(error.message).not.toContain('sk-');
      });
    });

    // Regression for Codex P2 follow-up (`shareChat.ts:249`):
    // `AiAgentService.execAgent` RESOLVES (rather than throws) with
    // `{ success: false, error }` when `createOperation` itself fails to
    // start (see `aiAgent/index.ts`'s `execAgent` catch block) — a case the
    // surrounding try/catch above never sees because nothing was thrown.
    // Without a check on the resolved value, that raw `error` (and the
    // whole "started" shape) would flow straight back to the visitor and
    // the Gateway client would try to open a WebSocket for an operation
    // that never began.
    it('redacts a RESOLVED (not thrown) startup failure and never returns it as a live operation', async () => {
      const diagnostic =
        'QStash publish failed: 503 from internal-queue.prod.internal (token=shhh)';
      mockExecAgent.mockResolvedValueOnce({
        agentId: share.agentId,
        assistantMessageId: 'msg_assistant',
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: diagnostic,
        message: 'Agent operation failed to start',
        operationId: 'op-failed',
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId: 'tpc_visitor',
        userMessageId: 'msg_user',
      });
      const caller = await createCaller();

      const rejection = caller.execAgent({ prompt: 'hi', shareId: 'share-1' });
      await expect(rejection).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
      await rejection.catch((error: any) => {
        expect(error.message).not.toContain('internal-queue');
        expect(error.message).not.toContain('token=shhh');
      });
    });

    it('never sets interactiveStart, so concurrent visitor sends contend on the real runningOperation liveness instead of only the short reservation', async () => {
      // Regression for Codex P1 (`shareChat.ts:186`): `interactiveStart:
      // true` makes `TopicModel.tryReserveTaskCallback` skip its `runningOperation`
      // liveness check entirely (`ignoreRunningOperation`) and contend only on the
      // short-lived `taskCallbackReservation`, which is released right after the
      // FIRST operation is created — long before it finishes running. That let a
      // second concurrent visitor send for the same topic claim the topic-start
      // reservation too, create its own creator-credentialed operation, and
      // overwrite the topic's `runningOperation` marker, orphaning the first
      // operation beyond the reach of `interruptTask` / the revocation sweep. See
      // `topicStartReservation.shareVisitorConcurrency.race.test.ts` for the
      // real-Postgres proof of the underlying reservation mechanics this pins.
      const caller = await createCaller();

      await caller.execAgent({ prompt: 'hi', shareId: 'share-1' });

      expect(mockExecAgent).toHaveBeenCalledWith(
        expect.objectContaining({ interactiveStart: false }),
      );
    });
  });

  describe('createUploadUrl', () => {
    const prefix = `files/${OWNER}/agent-share/share-1/`;

    it("reserves the upload under the CREATOR's storage quota and returns a share-prefixed key", async () => {
      const caller = await createCaller();

      const result = await caller.createUploadUrl({
        name: 'cat.png',
        shareId: 'share-1',
        size: 10,
      });

      expect(result.pathname.startsWith(prefix)).toBe(true);
      expect(result.pathname.endsWith('/cat.png')).toBe(true);
      expect(result.url).toBe('https://s3/put');
      // The quota that pays is the one reserved: creator, never the visitor.
      expect(FileUploadModelMock).toHaveBeenCalledWith(expect.anything(), OWNER);
      expect(mockReserveUpload).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: result.pathname, size: 10, userId: OWNER }),
      );
      expect(mockReserveUpload.mock.calls[0][0].workspaceId).toBeUndefined();
      expect(mockCreatePreSignedUrl).toHaveBeenCalledWith(result.pathname, 10);
    });

    it('keeps a visitor-supplied name from steering the key out of the share prefix', async () => {
      const caller = await createCaller();

      const result = await caller.createUploadUrl({
        name: '../../etc/passwd',
        shareId: 'share-1',
        size: 1,
      });

      expect(result.pathname.startsWith(prefix)).toBe(true);
      expect(result.pathname.endsWith('/.._.._etc_passwd')).toBe(true);
    });

    it("propagates the creator's storage_block reason and never reaches S3", async () => {
      mockReserveUpload.mockRejectedValue(
        new TRPCError({ code: 'FORBIDDEN', message: 'storage_block:upgrade_required' }),
      );
      const caller = await createCaller();

      await expect(
        caller.createUploadUrl({ name: 'cat.png', shareId: 'share-1', size: 10 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'storage_block:upgrade_required' });
      expect(mockCreatePreSignedUrl).not.toHaveBeenCalled();
    });

    it('releases the reservation when minting the pre-signed URL fails', async () => {
      mockCreatePreSignedUrl.mockRejectedValue(new Error('s3 down'));
      const caller = await createCaller();

      await expect(
        caller.createUploadUrl({ name: 'cat.png', shareId: 'share-1', size: 10 }),
      ).rejects.toThrow('s3 down');
      expect(mockUploadReleaseBestEffort).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${prefix}`)),
      );
    });

    it('rejects a file over SHARE_VISITOR_MAX_FILE_SIZE at the schema', async () => {
      const caller = await createCaller();

      await expect(
        caller.createUploadUrl({ name: 'big.bin', shareId: 'share-1', size: 33 * 1024 * 1024 }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mockReserveUpload).not.toHaveBeenCalled();
    });

    it('is refused on a private share like every other visitor procedure', async () => {
      mockAccessCheck.mockResolvedValue({ ...share, visibility: 'private' });
      const caller = await createCaller();

      await expect(
        caller.createUploadUrl({ name: 'cat.png', shareId: 'share-1', size: 10 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockReserveUpload).not.toHaveBeenCalled();
    });
  });

  describe('createFile', () => {
    const pathname = `files/${OWNER}/agent-share/share-1/abc/cat.png`;
    const input = {
      fileType: 'image/png',
      hash: 'h'.repeat(64),
      metadata: { height: 2, ratio: 0.5, width: 1 },
      name: 'cat.png',
      pathname,
      shareId: 'share-1',
      size: 10,
    };

    beforeEach(() => {
      mockUploadTouchActive.mockResolvedValue({ id: 'upload-1', size: 10, status: 'active' });
      mockUploadFindLatestForUpdate.mockResolvedValue({
        id: 'upload-1',
        size: 10,
        status: 'active',
      });
    });

    it('writes a creator-owned agent_share row with the visitor in its provenance and settles the session', async () => {
      const caller = await createCaller();

      const result = await caller.createFile(input);

      expect(result).toEqual({ id: 'file-new', url: 'https://s3/get' });
      expect(FileModelMock).toHaveBeenCalledWith(expect.anything(), OWNER);
      expect(mockFileCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          fileHash: input.hash,
          fileType: 'image/png',
          metadata: expect.objectContaining({
            agentShare: { shareId: 'share-1', visitorUserId: VISITOR },
            dirname: `files/${OWNER}/agent-share/share-1/abc`,
            filename: 'cat.png',
            height: 2,
            path: pathname,
            width: 1,
          }),
          name: 'cat.png',
          size: 10,
          source: 'agent_share',
          url: pathname,
        }),
        true,
        expect.anything(),
      );
      expect(mockUploadSettle).toHaveBeenCalledWith('upload-1', 'file-new', expect.anything());
    });

    it('refuses a pathname outside the share prefix (a creator-owned reservation)', async () => {
      const caller = await createCaller();

      await expect(
        caller.createFile({ ...input, pathname: `files/${OWNER}/2026/own.png` }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Upload not found' });
      expect(mockUploadTouchActive).not.toHaveBeenCalled();
      expect(mockFileCreate).not.toHaveBeenCalled();
    });

    it("refuses another share's prefix even for the same creator", async () => {
      const caller = await createCaller();

      await expect(
        caller.createFile({ ...input, pathname: `files/${OWNER}/agent-share/share-2/abc/cat.png` }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockFileCreate).not.toHaveBeenCalled();
    });

    it('rejects when there is no active reservation (no legacy path for share uploads)', async () => {
      mockUploadTouchActive.mockResolvedValue(undefined);
      const caller = await createCaller();

      await expect(caller.createFile(input)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(mockFileCreate).not.toHaveBeenCalled();
    });

    it('releases the reservation when the stored object size does not match', async () => {
      mockGetFileMetadata.mockResolvedValue({ contentLength: 11 });
      const caller = await createCaller();

      await expect(caller.createFile(input)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Uploaded file size mismatch',
      });
      expect(mockUploadReleaseBestEffort).toHaveBeenCalledWith(pathname);
      expect(mockFileCreate).not.toHaveBeenCalled();
    });

    it('drops unknown metadata keys at the schema so provenance can only be server-written', async () => {
      const caller = await createCaller();

      await caller.createFile({
        ...input,
        metadata: {
          ...input.metadata,
          agentShare: { shareId: 'share-1', visitorUserId: 'someone-else' },
        } as any,
      });

      expect(mockFileCreate.mock.calls[0][0].metadata.agentShare).toEqual({
        shareId: 'share-1',
        visitorUserId: VISITOR,
      });
    });
  });

  describe('abortUpload', () => {
    it('releases an active reservation under the share prefix', async () => {
      const pathname = `files/${OWNER}/agent-share/share-1/abc/cat.png`;
      mockUploadFindLatest.mockResolvedValue({ status: 'active' });
      const caller = await createCaller();

      await caller.abortUpload({ pathname, shareId: 'share-1' });

      expect(FileUploadServiceMock).toHaveBeenCalledWith(expect.anything(), OWNER);
      expect(mockUploadRelease).toHaveBeenCalledWith(pathname);
    });

    it("cannot release a reservation outside the share prefix (the creator's own upload)", async () => {
      const caller = await createCaller();

      await expect(
        caller.abortUpload({ pathname: `files/${OWNER}/2026/own.png`, shareId: 'share-1' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockUploadRelease).not.toHaveBeenCalled();
    });
  });

  describe('removeFile', () => {
    const provenance = { agentShare: { shareId: 'share-1', visitorUserId: VISITOR } };

    it("deletes this visitor's own unsent share upload and the stored object", async () => {
      mockFileFindById.mockResolvedValue({
        id: 'file-a',
        metadata: provenance,
        source: 'agent_share',
      });
      mockFileDeleteUnreferenced.mockResolvedValue({ id: 'file-a', url: 'files/x/cat.png' });
      const caller = await createCaller();

      await caller.removeFile({ fileId: 'file-a', shareId: 'share-1' });

      expect(FileModelMock).toHaveBeenCalledWith(expect.anything(), OWNER);
      expect(mockFileDeleteUnreferenced).toHaveBeenCalledWith('file-a', true);
      expect(mockDeleteStoredFile).toHaveBeenCalledWith('files/x/cat.png');
    });

    it('leaves the stored object alone when the row is already referenced by a message', async () => {
      mockFileFindById.mockResolvedValue({
        id: 'file-a',
        metadata: provenance,
        source: 'agent_share',
      });
      mockFileDeleteUnreferenced.mockResolvedValue(undefined);
      const caller = await createCaller();

      await caller.removeFile({ fileId: 'file-a', shareId: 'share-1' });

      expect(mockDeleteStoredFile).not.toHaveBeenCalled();
    });

    it("refuses the creator's own file and another visitor's share upload alike", async () => {
      const caller = await createCaller();

      mockFileFindById.mockResolvedValue({ id: 'file-a', metadata: null, source: null });
      await expect(
        caller.removeFile({ fileId: 'file-a', shareId: 'share-1' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'File not found' });

      mockFileFindById.mockResolvedValue({
        id: 'file-a',
        metadata: { agentShare: { shareId: 'share-1', visitorUserId: 'visitor-2' } },
        source: 'agent_share',
      });
      await expect(
        caller.removeFile({ fileId: 'file-a', shareId: 'share-1' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockFileDeleteUnreferenced).not.toHaveBeenCalled();
    });
  });

  describe('interruptTask', () => {
    it('interrupts a running operation that matches the topic ownership and running marker', async () => {
      const caller = await createCaller();

      await expect(
        caller.interruptTask({ operationId: 'op-1', shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).resolves.toMatchObject({ operationId: 'op-1', success: true });

      // Service runs as the CREATOR — the run's operation/thread rows live there.
      expect(AiAgentServiceMock).toHaveBeenCalledWith(expect.anything(), OWNER, {
        includeShareVisitor: true,
      });
      expect(mockInterruptTask).toHaveBeenCalledWith({
        operationId: 'op-1',
        topicId: 'tpc_visitor',
      });
    });

    it("fails closed when the topic is not the visitor's own share topic", async () => {
      mockFindById.mockResolvedValue({ ...visitorTopic, senderId: 'someone-else' });
      const caller = await createCaller();

      await expect(
        caller.interruptTask({ operationId: 'op-1', shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockInterruptTask).not.toHaveBeenCalled();
    });

    it('rejects an operationId that does not match the topic’s current running operation', async () => {
      const caller = await createCaller();

      await expect(
        caller.interruptTask({
          operationId: 'op-someone-elses',
          shareId: 'share-1',
          topicId: 'tpc_visitor',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockInterruptTask).not.toHaveBeenCalled();
    });

    it('rejects when the topic has no running operation at all', async () => {
      mockFindById.mockResolvedValue({ ...visitorTopic, metadata: {} });
      const caller = await createCaller();

      await expect(
        caller.interruptTask({ operationId: 'op-1', shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockInterruptTask).not.toHaveBeenCalled();
    });

    // Regression for Codex P2: same startup-failure redaction as
    // `execAgent` — `AiAgentService.interruptTask` also runs creator-scoped
    // and can throw a raw infra/provider diagnostic before any Gateway event
    // exists to sanitize.
    it('redacts a diagnostic interrupt failure instead of leaking it to the visitor', async () => {
      const diagnostic = new Error(
        'pg driver error: relation "operations_internal" does not exist',
      );
      mockInterruptTask.mockRejectedValueOnce(diagnostic);
      const caller = await createCaller();

      const rejection = caller.interruptTask({
        operationId: 'op-1',
        shareId: 'share-1',
        topicId: 'tpc_visitor',
      });
      await expect(rejection).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
      await rejection.catch((error: any) => {
        expect(error.message).not.toContain('operations_internal');
        expect(error.message).not.toContain('pg driver');
      });
    });
  });

  describe('getTopics', () => {
    it("returns only the visitor's own topics via agentId + senderId scoping", async () => {
      const caller = await createCaller();
      await caller.getTopics({ shareId: 'share-1' });

      // Topic model is creator-scoped; the query narrows to this visitor's own
      // topics on this agent. `agent_shares` is 1:1 per agent, so `(agentId,
      // senderId)` unambiguously identifies the share conversation without a
      // share-instance column on `topics`.
      expect(TopicModelMock).toHaveBeenCalledWith(expect.anything(), OWNER, undefined, undefined, {
        includeShareVisitor: true,
      });
      expect(mockQueryBySender).toHaveBeenCalledWith({
        agentId: share.agentId,
        senderId: VISITOR,
      });
    });

    it('does not tie the list page size to the live maxTopicsPerVisitor cap', async () => {
      // The cap only gates admission of NEW topics. A creator lowering it below
      // what a visitor already created must not hide those older conversations —
      // the visitor surface has no pagination or deep links to recover them.
      mockAccessCheck.mockResolvedValue({
        ...share,
        shareConfig: { ...share.shareConfig, maxTopicsPerVisitor: 1 },
      });
      const caller = await createCaller();
      await caller.getTopics({ shareId: 'share-1' });

      expect(mockQueryBySender).toHaveBeenCalledWith({
        agentId: share.agentId,
        senderId: VISITOR,
      });
    });
  });

  describe('getMessages', () => {
    it('rejects a topic on a different agent of the same creator', async () => {
      mockFindById.mockResolvedValue({ ...visitorTopic, agentId: 'agt_other' });
      const caller = await createCaller();

      await expect(
        caller.getMessages({ shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockMessageQueryForVisitor).not.toHaveBeenCalled();
    });

    it('serves messages without Work summaries', async () => {
      const caller = await createCaller();
      await caller.getMessages({ shareId: 'share-1', topicId: 'tpc_visitor' });

      expect(mockMessageQueryForVisitor).toHaveBeenCalledWith(
        { skipWorks: true, topicId: 'tpc_visitor' },
        expect.objectContaining({
          redaction: {
            showErrorDetails: undefined,
            showModelInfo: undefined,
          },
        }),
      );
    });

    it('uses the visitor-redacted read path, never the raw creator-scoped query()', async () => {
      // Regression: getMessages must call `queryForVisitor` (which strips the
      // creator's sender/spend fields), not `query()` — see message.ts
      // `toVisitorMessage` for what that redaction guards against.
      const caller = await createCaller();
      await caller.getMessages({ shareId: 'share-1', topicId: 'tpc_visitor' });

      expect(mockMessageQuery).not.toHaveBeenCalled();
    });
  });

  describe('issueGatewayUserToken', () => {
    it('signs the per-user hub token for the VISITOR, never the creator', async () => {
      const caller = await createCaller();

      await expect(caller.issueGatewayUserToken({ shareId: 'share-1' })).resolves.toEqual({
        token: 'visitor-jwt',
      });
      expect(mockSignUserJWT).toHaveBeenCalledWith(VISITOR);
      expect(mockAccessCheck).toHaveBeenCalledWith(expect.anything(), 'share-1', VISITOR);
    });

    // The v2 hub socket is per user, not per operation: the hub authorizes
    // each `subscribe` against the op's registered owner, so minting must not
    // depend on a topic marker or a live run (a visitor opens the socket
    // before their first send).
    it('does not require a topic or a running operation', async () => {
      mockFindById.mockResolvedValue(undefined);
      mockIsRunningOperationAlive.mockResolvedValue(false);
      const caller = await createCaller();

      await expect(caller.issueGatewayUserToken({ shareId: 'share-1' })).resolves.toEqual({
        token: 'visitor-jwt',
      });
      expect(mockFindById).not.toHaveBeenCalled();
      expect(mockIsRunningOperationAlive).not.toHaveBeenCalled();
    });

    it('rejects an unknown share without signing anything', async () => {
      mockAccessCheck.mockRejectedValue(
        new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' }),
      );
      const caller = await createCaller();

      await expect(caller.issueGatewayUserToken({ shareId: 'missing' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(mockSignUserJWT).not.toHaveBeenCalled();
    });

    it('rejects a share that is not link-visible', async () => {
      mockAccessCheck.mockResolvedValue({ ...share, visibility: 'private' });
      const caller = await createCaller();

      await expect(caller.issueGatewayUserToken({ shareId: 'share-1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mockSignUserJWT).not.toHaveBeenCalled();
    });
  });

  describe('refreshGatewayToken', () => {
    it('signs the token for the VISITOR, never the creator', async () => {
      const caller = await createCaller();

      await expect(
        caller.refreshGatewayToken({ shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).resolves.toEqual({ token: 'visitor-jwt' });
      expect(mockSignUserJWT).toHaveBeenCalledWith(VISITOR);
    });

    it('rejects when the topic has no running operation', async () => {
      mockFindById.mockResolvedValue({ ...visitorTopic, metadata: {} });
      const caller = await createCaller();

      await expect(
        caller.refreshGatewayToken({ shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockSignUserJWT).not.toHaveBeenCalled();
    });

    // The marker is cleared best-effort at finish, so a stale one must not
    // send the visitor's browser to reconnect to a finished run (it would
    // register the topic as "running" locally and freeze its message list).
    it('rejects when the marker points at a run that already ended', async () => {
      mockIsRunningOperationAlive.mockResolvedValue(false);
      const caller = await createCaller();

      await expect(
        caller.refreshGatewayToken({ shareId: 'share-1', topicId: 'tpc_visitor' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockIsRunningOperationAlive).toHaveBeenCalledWith(
        expect.anything(),
        visitorTopic.metadata.runningOperation,
      );
      expect(mockSignUserJWT).not.toHaveBeenCalled();
    });
  });

  it('requires authentication', async () => {
    const caller = shareChatRouter.createCaller(await createContextInner());

    await expect(caller.getTopics({ shareId: 'share-1' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  describe('visitor capability', () => {
    it('rejects on a deployment without business features, before any share lookup', async () => {
      mocks.businessConst.ENABLE_BUSINESS_FEATURES = false;
      const caller = await createCaller();

      await expect(caller.getTopics({ shareId: 'share-1' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mockAccessCheck).not.toHaveBeenCalled();
    });

    it.each([false, undefined])(
      'admits visitor procedures when the agent share flag is %s',
      async (enableAgentShare) => {
        mockGetFeatureFlagsState.mockResolvedValue({ enableAgentShare });
        mockMessageQueryForVisitor.mockResolvedValue([]);
        const caller = await createCaller();

        await expect(caller.getTopics({ shareId: 'share-1' })).resolves.toEqual([]);
        await expect(
          caller.getMessages({ shareId: 'share-1', topicId: 'tpc_visitor' }),
        ).resolves.toEqual([]);
        await expect(caller.execAgent({ prompt: 'hi', shareId: 'share-1' })).resolves.toMatchObject(
          {
            success: true,
          },
        );
        await expect(
          caller.interruptTask({ operationId: 'op-1', shareId: 'share-1', topicId: 'tpc_visitor' }),
        ).resolves.toMatchObject({ success: true });
        await expect(
          caller.refreshGatewayToken({ shareId: 'share-1', topicId: 'tpc_visitor' }),
        ).resolves.toEqual({ token: 'visitor-jwt' });
        await expect(caller.issueGatewayUserToken({ shareId: 'share-1' })).resolves.toEqual({
          token: 'visitor-jwt',
        });
        expect(mockGetFeatureFlagsState).not.toHaveBeenCalled();
      },
    );
  });
});
