// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-builtin-quick-note-test-user';
const agentModel = new AgentModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('AgentModel builtin Quick Note Analyzer', () => {
  /** @example Quick Note Analyzer capability edits survive later lazy initialization. */
  it('preserves user configuration for the Quick Note Analyzer', async () => {
    const created = await agentModel.getBuiltinAgent('quick-note-analyze');
    await serverDB
      .update(agents)
      .set({
        chatConfig: { enableAgentMode: true, searchMode: 'auto' },
        model: 'custom-model',
        plugins: ['lobe-web-browsing'],
      })
      .where(eq(agents.id, created!.id));

    const resolved = await agentModel.getBuiltinAgent('quick-note-analyze');

    /** @example Lazy materialization no longer resets the configured capabilities. */
    expect(resolved).toMatchObject({
      chatConfig: { enableAgentMode: true, searchMode: 'auto' },
      model: 'custom-model',
      plugins: ['lobe-web-browsing'],
    });
  });

  /** @example Product-managed builtin Agents cannot be removed as ordinary content. */
  it('rejects deletion of the Quick Note Analyzer', async () => {
    const created = await agentModel.getBuiltinAgent('quick-note-analyze');

    /** @example The shared builtin-Agent delete guard also covers the Analyzer. */
    await expect(agentModel.delete(created!.id)).rejects.toThrow(
      'A builtin agent cannot be deleted',
    );
  });
});
