// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { LobeChatDatabase } from '../../type';
import { ApiKeyModel } from '../apiKey';

const serverDB: LobeChatDatabase = await getTestDB();

describe('ApiKeyModel coverage edges', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('findByKey rejects a malformed key without querying', async () => {
    const selectSpy = vi.spyOn(serverDB, 'select');

    await expect(ApiKeyModel.findByKey(serverDB, 'not-an-api-key')).resolves.toBeNull();
    expect(selectSpy).not.toHaveBeenCalled();
  });
});
