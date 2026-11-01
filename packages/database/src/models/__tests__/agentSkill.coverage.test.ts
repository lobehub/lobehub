// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { LobeChatDatabase } from '../../type';
import { AgentSkillModel } from '../agentSkill';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'askcov-user';

describe('AgentSkillModel coverage edges', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delete reports no success when the driver returns a null rowCount', async () => {
    // node-postgres types `rowCount` as `number | null`; a driver result without
    // an affected-row count must not be read as a successful delete.
    const where = vi.fn().mockResolvedValue({ rowCount: null });
    vi.spyOn(serverDB, 'delete').mockReturnValueOnce({ where } as unknown as ReturnType<
      LobeChatDatabase['delete']
    >);

    const model = new AgentSkillModel(serverDB, userId);

    await expect(model.delete('askcov-skill')).resolves.toEqual({ success: false });
    expect(where).toHaveBeenCalledTimes(1);
  });
});
