// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { DeletedResourceSchema, DeletedResourcesSchema } from '../types/common.type';
import { MemoryRestService } from './memory.service';

const {
  deleteAllMock,
  deletePersonaMock,
  preferenceDeleteMock,
  removeIdentityEntryMock,
  resetMemoryExtractStatusMock,
} = vi.hoisted(() => ({
  deleteAllMock: vi.fn(),
  deletePersonaMock: vi.fn(),
  preferenceDeleteMock: vi.fn(),
  removeIdentityEntryMock: vi.fn(),
  resetMemoryExtractStatusMock: vi.fn(),
}));

vi.mock('@/database/models/rbac', () => ({ RbacModel: class {} }));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    resetMemoryExtractStatus = resetMemoryExtractStatusMock;
  },
}));
vi.mock('@/database/models/userMemory', () => {
  const layer = class {
    delete = vi.fn();
  };
  return {
    UserMemoryActivityModel: layer,
    UserMemoryContextModel: layer,
    UserMemoryExperienceModel: layer,
    UserMemoryModel: class {
      deleteAll = deleteAllMock;
      removeIdentityEntry = removeIdentityEntryMock;
    },
    UserMemoryPreferenceModel: class {
      delete = preferenceDeleteMock;
    },
  };
});
vi.mock('@/database/models/userMemory/persona', () => ({
  UserPersonaModel: class {
    deletePersona = deletePersonaMock;
  },
}));
vi.mock('@/database/models/userMemory/where', () => ({ buildUserMemoryWhere: vi.fn() }));

/** A db whose transaction runs the callback on a tx that counts `rows` memories. */
const fakeDb = (rows: number) => {
  const tx = {
    select: () => ({ from: () => ({ where: async () => [{ count: rows }] }) }),
  };
  return {
    transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  } as unknown as LobeChatDatabase;
};

describe('MemoryRestService deletes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers an entry delete with the removed id', async () => {
    removeIdentityEntryMock.mockResolvedValue(true);

    const result = await new MemoryRestService(fakeDb(0), 'user-1').deleteEntry(
      'identities',
      'idn-1',
    );

    expect(DeletedResourceSchema.parse(result)).toEqual({ deleted: true, id: 'idn-1' });
  });

  it('reports an entry the caller does not have as not found', async () => {
    preferenceDeleteMock.mockResolvedValue({ success: false });

    await expect(
      new MemoryRestService(fakeDb(0), 'user-1').deleteEntry('preferences', 'pref-1'),
    ).rejects.toThrow(/Memory entry not found/);
  });

  it('counts the memories a purge removed and still resets persona and extraction', async () => {
    const result = await new MemoryRestService(fakeDb(3), 'user-1').deleteAll();

    expect(DeletedResourcesSchema.parse(result)).toEqual({ count: 3, deleted: true });
    expect(deleteAllMock).toHaveBeenCalledTimes(1);
    expect(deletePersonaMock).toHaveBeenCalledTimes(1);
    expect(resetMemoryExtractStatusMock).toHaveBeenCalledTimes(1);
  });
});
