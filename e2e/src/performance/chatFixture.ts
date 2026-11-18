import { randomBytes } from 'node:crypto';

import { TEST_USER } from '../support/seedTestUser';

export interface ChatFixture {
  agentId: string;
  /** Text of each topic's last message; visible once that topic's transcript has rendered. */
  markers: string[];
  topicIds: string[];
}

/** Enough topics that the uncached and cold rounds each switch to a topic not yet opened. */
const TOPIC_COUNT = 8;
/** Turns per topic. Each assistant reply carries markdown, a list and a code block. */
const TURNS_PER_TOPIC = 12;

const assistantReply = (topic: number, turn: number) => `### Step ${turn + 1} of topic ${topic + 1}

Here is a summary of what changed and why it matters for the rollout:

- The cache now keeps **${turn + 3}** entries per conversation.
- Older entries are evicted in insertion order.
- Readers see the newest entry first.

\`\`\`ts
export const pickEntry = (entries: string[], index: number) =>
  entries.at(index % entries.length) ?? entries[0];
\`\`\`

The next step checks that the eviction keeps the newest ${turn + 1} replies visible.`;

const connect = async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL not set');

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
};

/**
 * Seeds one agent with `TOPIC_COUNT` topics of `TURNS_PER_TOPIC` turns straight
 * into the database, so every run measures the same transcript sizes without
 * driving the mocked LLM.
 */
export const seedChatFixture = async (): Promise<ChatFixture> => {
  const client = await connect();
  const suffix = randomBytes(6).toString('hex');
  const agentId = `agent_e2e_perf_${suffix}`;
  const topicIds: string[] = [];
  const markers: string[] = [];
  // Topics are listed newest first; stagger timestamps so the order is stable.
  const base = Date.now() - TOPIC_COUNT * TURNS_PER_TOPIC * 2 * 1000;

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO agents (id, slug, title, user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [agentId, `perf-agent-${suffix}`, 'Render Budget Agent', TEST_USER.id],
    );

    for (let topic = 0; topic < TOPIC_COUNT; topic += 1) {
      const topicId = `tpc_e2e_perf_${suffix}_${topic}`;
      const marker = `Render budget end of topic ${topic + 1} ${suffix}`;
      const topicAt = new Date(base + topic * TURNS_PER_TOPIC * 2 * 1000);

      await client.query(
        `INSERT INTO topics (id, title, agent_id, user_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [topicId, `Render budget topic ${topic + 1}`, agentId, TEST_USER.id, topicAt.toISOString()],
      );

      let parentId: string | null = null;
      for (let index = 0; index < TURNS_PER_TOPIC * 2; index += 1) {
        const turn = Math.floor(index / 2);
        const isUser = index % 2 === 0;
        const isLast = index === TURNS_PER_TOPIC * 2 - 1;
        const messageId = `msg_e2e_perf_${suffix}_${topic}_${index}`;
        const content = isUser
          ? `Question ${turn + 1}: how should the cache behave for topic ${topic + 1}?`
          : `${assistantReply(topic, turn)}${isLast ? `\n\n${marker}` : ''}`;
        const createdAt = new Date(topicAt.getTime() + index * 1000).toISOString();

        await client.query(
          `INSERT INTO messages (id, role, content, model, provider, user_id, agent_id, topic_id, parent_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
          [
            messageId,
            isUser ? 'user' : 'assistant',
            content,
            isUser ? null : 'gpt-4o-mini',
            isUser ? null : 'openai',
            TEST_USER.id,
            agentId,
            topicId,
            parentId,
            createdAt,
          ],
        );
        parentId = messageId;
      }

      topicIds.push(topicId);
      markers.push(marker);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }

  return { agentId, markers, topicIds };
};

/** Topics and messages cascade from the agent. */
export const removeChatFixture = async (fixture: ChatFixture) => {
  const client = await connect();
  try {
    await client.query('DELETE FROM agents WHERE id = $1', [fixture.agentId]);
  } finally {
    await client.end();
  }
};
