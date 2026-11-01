import { unstable_serialize } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LEGACY_MESSAGE_CACHE_VERSION, messageKeys } from '../keys';
import { buildLocalDataKey, localDataCache, type ScopeEntry } from '../localDataCache';
import { migrateMessageListCache } from './messageListCache';

const PROVIDER_VERSION = '1.0.0';
const PERSONAL_SCOPE = 'user-1:personal';
const WORKSPACE_SCOPE = 'user-1:workspace-1';
const OTHER_SCOPE = 'user-2:personal';

const messages = [
  {
    agentId: 'agent-1',
    content: 'hello',
    createdAt: 1,
    id: 'message-1',
    role: 'user',
    threadId: null,
    topicId: 'topic-1',
    updatedAt: 1,
  },
];

const createEntry = (
  originalKey: readonly unknown[],
  data = messages,
  updatedAt = 1,
): ScopeEntry => ({
  data: { _k: originalKey, data },
  key: unstable_serialize(originalKey),
  updatedAt,
  version: PROVIDER_VERSION,
});

const seedEntries = async (scope: string, entries: ScopeEntry[]) => {
  await localDataCache.applyBatch({
    deleteKeys: [],
    putEntries: entries.map((entry) => ({
      ...entry,
      key: buildLocalDataKey(scope, entry.key),
    })),
  });
};

describe('migrateMessageListCache', () => {
  beforeEach(async () => {
    await Promise.all(
      [PERSONAL_SCOPE, WORKSPACE_SCOPE, OTHER_SCOPE].map((scope) =>
        localDataCache.clearScope(scope),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('moves a v1 workspace row to the canonical v2 key before hydration', async () => {
    const legacyKey = [
      messageKeys.list.root,
      {
        agentId: 'agent-1',
        scope: 'main',
        threadId: null,
        topicId: 'topic-1',
        workspaceSlug: 'workspace',
      },
      LEGACY_MESSAGE_CACHE_VERSION,
      'workspace-1',
    ];
    const legacyEntry = createEntry(legacyKey);
    await seedEntries(WORKSPACE_SCOPE, [legacyEntry]);

    const result = await migrateMessageListCache({
      entries: await localDataCache.entriesByScope(WORKSPACE_SCOPE),
      providerVersion: PROVIDER_VERSION,
      scope: WORKSPACE_SCOPE,
    });
    const canonicalKey = [
      ...messageKeys.list({ agentId: 'agent-1', threadId: null, topicId: 'topic-1' }),
      'workspace-1',
    ];
    const canonicalSerializedKey = unstable_serialize(canonicalKey);

    expect(result).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ _k: canonicalKey, data: messages }),
        key: canonicalSerializedKey,
      }),
    ]);

    const persisted = await localDataCache.entriesByScope(WORKSPACE_SCOPE);
    expect(persisted.some((entry) => entry.key === legacyEntry.key)).toBe(false);
    expect(persisted).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ _k: canonicalKey, data: messages }),
        key: canonicalSerializedKey,
      }),
    ]);
  });

  it('collapses equivalent legacy variants and keeps the newest snapshot', async () => {
    const older = createEntry(
      [
        messageKeys.list.root,
        { agentId: 'agent-1', scope: 'main', topicId: 'topic-1' },
        LEGACY_MESSAGE_CACHE_VERSION,
      ],
      [{ ...messages[0], content: 'old' }],
      10,
    );
    const newer = createEntry(
      [
        messageKeys.list.root,
        {
          agentId: 'agent-1',
          documentId: undefined,
          threadId: null,
          topicId: 'topic-1',
        },
        LEGACY_MESSAGE_CACHE_VERSION,
      ],
      [{ ...messages[0], content: 'new' }],
      20,
    );

    const result = await migrateMessageListCache({
      entries: [older, newer],
      providerVersion: PROVIDER_VERSION,
      scope: PERSONAL_SCOPE,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ data: [{ ...messages[0], content: 'new' }] }),
        updatedAt: 20,
      }),
    );
  });

  it('also migrates historical versionless and message:listLegacy rows', async () => {
    const versionless = createEntry([
      messageKeys.list.root,
      { agentId: 'agent-1', scope: 'main', topicId: 'topic-1' },
    ]);
    const listLegacy = createEntry(
      ['message:listLegacy', { agentId: 'agent-1', topicId: 'topic-1' }],
      [{ ...messages[0], content: 'newest legacy' }],
      2,
    );

    const result = await migrateMessageListCache({
      entries: [versionless, listLegacy],
      providerVersion: PROVIDER_VERSION,
      scope: PERSONAL_SCOPE,
    });

    expect(result).toHaveLength(1);
    expect(result[0].data).toEqual(
      expect.objectContaining({ data: [{ ...messages[0], content: 'newest legacy' }] }),
    );
  });

  it('leaves existing v2 and non-message rows unchanged on repeated hydration', async () => {
    const v2 = createEntry(messageKeys.list({ agentId: 'agent-1', topicId: 'topic-1' }));
    const topicEntry: ScopeEntry = {
      data: { _k: ['topic:list', 'agent-1'], data: [] },
      key: unstable_serialize(['topic:list', 'agent-1']),
      updatedAt: 2,
      version: PROVIDER_VERSION,
    };
    const batchSpy = vi.spyOn(localDataCache, 'applyBatch');

    const result = await migrateMessageListCache({
      entries: [v2, topicEntry],
      providerVersion: PROVIDER_VERSION,
      scope: PERSONAL_SCOPE,
    });

    expect(result).toEqual([v2, topicEntry]);
    expect(batchSpy).not.toHaveBeenCalled();
  });

  it('keeps an original-key-less v2 empty snapshot written before a hook mounts', async () => {
    const canonicalKey = messageKeys.list({ agentId: 'agent-1', topicId: 'topic-1' });
    const v2WithoutOriginalKey: ScopeEntry = {
      data: { data: [] },
      key: unstable_serialize(canonicalKey),
      updatedAt: 2,
      version: PROVIDER_VERSION,
    };
    const batchSpy = vi.spyOn(localDataCache, 'applyBatch');

    const result = await migrateMessageListCache({
      entries: [v2WithoutOriginalKey],
      providerVersion: PROVIDER_VERSION,
      scope: PERSONAL_SCOPE,
    });

    expect(result).toEqual([v2WithoutOriginalKey]);
    expect(batchSpy).not.toHaveBeenCalled();
  });

  it('recovers an original-key-less message:listLegacy row from its message identities', async () => {
    const legacyKey = ['message:listLegacy', { agentId: 'agent-1', topicId: 'topic-1' }];
    const legacyWithoutOriginalKey: ScopeEntry = {
      data: { data: messages },
      key: unstable_serialize(legacyKey),
      updatedAt: 2,
      version: PROVIDER_VERSION,
    };

    const result = await migrateMessageListCache({
      entries: [legacyWithoutOriginalKey],
      providerVersion: PROVIDER_VERSION,
      scope: PERSONAL_SCOPE,
    });

    expect(result).toEqual([
      expect.objectContaining({
        key: unstable_serialize(
          messageKeys.list({ agentId: 'agent-1', threadId: null, topicId: 'topic-1' }),
        ),
      }),
    ]);
  });

  it('recovers an original-key-less workspace row only when every message identity agrees', async () => {
    const legacyKey = [
      messageKeys.list.root,
      { agentId: 'agent-1', scope: 'main', topicId: 'topic-1' },
      LEGACY_MESSAGE_CACHE_VERSION,
      'workspace-1',
    ];
    const legacyWithoutOriginalKey: ScopeEntry = {
      data: { data: messages },
      key: unstable_serialize(legacyKey),
      updatedAt: 2,
      version: PROVIDER_VERSION,
    };

    const result = await migrateMessageListCache({
      entries: [legacyWithoutOriginalKey],
      providerVersion: PROVIDER_VERSION,
      scope: WORKSPACE_SCOPE,
    });

    expect(result).toEqual([
      expect.objectContaining({
        key: unstable_serialize([
          ...messageKeys.list({ agentId: 'agent-1', threadId: null, topicId: 'topic-1' }),
          'workspace-1',
        ]),
      }),
    ]);
  });

  it('does not let a provider-version-mismatched v2 row block migration', async () => {
    const canonicalKey = messageKeys.list({ agentId: 'agent-1', topicId: 'topic-1' });
    const staleV2 = {
      ...createEntry(canonicalKey, [{ ...messages[0], content: 'stale provider' }]),
      version: '0.0.1',
    };
    const legacy = createEntry(
      [
        messageKeys.list.root,
        { agentId: 'agent-1', scope: 'main', topicId: 'topic-1' },
        LEGACY_MESSAGE_CACHE_VERSION,
      ],
      [{ ...messages[0], content: 'current provider' }],
    );

    const result = await migrateMessageListCache({
      entries: [staleV2, legacy],
      providerVersion: PROVIDER_VERSION,
      scope: PERSONAL_SCOPE,
    });

    expect(
      result.find(
        (entry) =>
          entry.key === unstable_serialize(canonicalKey) && entry.version === PROVIDER_VERSION,
      )?.data,
    ).toEqual(expect.objectContaining({ data: [{ ...messages[0], content: 'current provider' }] }));
  });

  it('drops malformed or ambiguous legacy rows instead of guessing a conversation', async () => {
    const malformed = createEntry([messageKeys.list.root, {}, LEGACY_MESSAGE_CACHE_VERSION]);
    const ambiguousKey = [
      messageKeys.list.root,
      { agentId: 'agent-1', topicId: 'topic-1' },
      LEGACY_MESSAGE_CACHE_VERSION,
    ];
    const ambiguous: ScopeEntry = {
      data: {
        data: messages.map(({ threadId: _, ...message }) => message),
      },
      key: unstable_serialize(ambiguousKey),
      updatedAt: 2,
      version: PROVIDER_VERSION,
    };

    const result = await migrateMessageListCache({
      entries: [malformed, ambiguous],
      providerVersion: PROVIDER_VERSION,
      scope: PERSONAL_SCOPE,
    });

    expect(result).toEqual([]);
  });

  it('does not derive a conversation when one row has a null identity', async () => {
    const legacyKey = [
      messageKeys.list.root,
      { agentId: 'agent-1', topicId: 'topic-1' },
      LEGACY_MESSAGE_CACHE_VERSION,
    ];
    const mixedIdentity: ScopeEntry = {
      data: { data: [messages[0], { ...messages[0], agentId: null, id: 'message-2' }] },
      key: unstable_serialize(legacyKey),
      updatedAt: 2,
      version: PROVIDER_VERSION,
    };

    const result = await migrateMessageListCache({
      entries: [mixedIdentity],
      providerVersion: PROVIDER_VERSION,
      scope: PERSONAL_SCOPE,
    });

    expect(result).toEqual([]);
  });

  it('keeps the source persisted when the atomic migration transaction fails', async () => {
    const legacyEntry = createEntry([
      messageKeys.list.root,
      { agentId: 'agent-1', topicId: 'topic-1' },
      LEGACY_MESSAGE_CACHE_VERSION,
    ]);
    await seedEntries(PERSONAL_SCOPE, [legacyEntry]);
    const onError = vi.fn();
    const batchSpy = vi
      .spyOn(localDataCache, 'applyBatch')
      .mockRejectedValueOnce(new Error('write failed'));

    const result = await migrateMessageListCache({
      entries: await localDataCache.entriesByScope(PERSONAL_SCOPE),
      onError,
      providerVersion: PROVIDER_VERSION,
      scope: PERSONAL_SCOPE,
    });

    expect(result).toEqual([
      expect.objectContaining({
        key: unstable_serialize(messageKeys.list({ agentId: 'agent-1', topicId: 'topic-1' })),
      }),
    ]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'write failed' }));
    expect(await localDataCache.entriesByScope(PERSONAL_SCOPE)).toEqual([legacyEntry]);

    batchSpy.mockRestore();
    const retried = await migrateMessageListCache({
      entries: await localDataCache.entriesByScope(PERSONAL_SCOPE),
      providerVersion: PROVIDER_VERSION,
      scope: PERSONAL_SCOPE,
    });
    const canonicalKey = messageKeys.list({ agentId: 'agent-1', topicId: 'topic-1' });

    expect(retried).toEqual([expect.objectContaining({ key: unstable_serialize(canonicalKey) })]);
    expect(await localDataCache.entriesByScope(PERSONAL_SCOPE)).toEqual([
      expect.objectContaining({ key: unstable_serialize(canonicalKey) }),
    ]);
  });

  it('never reads, merges, or deletes another identity scope', async () => {
    const otherEntry = createEntry([
      messageKeys.list.root,
      { agentId: 'agent-1', topicId: 'topic-1' },
      LEGACY_MESSAGE_CACHE_VERSION,
    ]);
    await seedEntries(OTHER_SCOPE, [otherEntry]);

    await migrateMessageListCache({
      entries: [],
      providerVersion: PROVIDER_VERSION,
      scope: PERSONAL_SCOPE,
    });

    expect(await localDataCache.entriesByScope(OTHER_SCOPE)).toEqual([otherEntry]);
  });
});
