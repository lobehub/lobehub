// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentModel } from '../agent';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'subagent-effort-test-user-id';
const agentModel = new AgentModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

const createAgent = async (chatConfig: Record<string, unknown>) =>
  serverDB
    .insert(agents)
    .values({ agencyConfig: { subagent: { chatConfig, model: 'gpt-5.2' } } as any, userId })
    .returning()
    .then((res) => res[0]);

const readChatConfig = async (id: string) => {
  const row = await serverDB.query.agents.findFirst({ where: eq(agents.id, id) });
  return (row?.agencyConfig as any)?.subagent?.chatConfig;
};

describe('AgentModel.updateConfig sub-agent reasoning effort', () => {
  it('drops legacy effort keys when the patch sets reasoningEffort', async () => {
    // Regression: the deep merge kept gpt5_2ReasoningEffort next to the new
    // pick, so the migration script overwrote the pick with the old value
    const agent = await createAgent({ gpt5_2ReasoningEffort: 'low', urlContext: true });

    await agentModel.updateConfig(agent.id, {
      agencyConfig: { subagent: { chatConfig: { reasoningEffort: 'xhigh' } } },
    });

    expect(await readChatConfig(agent.id)).toEqual({ reasoningEffort: 'xhigh', urlContext: true });
  });

  it('keeps legacy effort keys for unrelated patches', async () => {
    const agent = await createAgent({ gpt5_2ReasoningEffort: 'low' });

    await agentModel.updateConfig(agent.id, {
      agencyConfig: { subagent: { chatConfig: { urlContext: true } } },
    });

    expect(await readChatConfig(agent.id)).toEqual({
      gpt5_2ReasoningEffort: 'low',
      urlContext: true,
    });
  });
});
