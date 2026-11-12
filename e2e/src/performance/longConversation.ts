/**
 * Long-conversation fixture for the message list render budget (`@perf`).
 *
 * The topic is written straight into PostgreSQL instead of being produced
 * through the UI: sending 1000 messages through the chat input would take
 * minutes and measure the send path, not the list.
 */

/** Messages per repeating cycle; message counts must be a multiple of it. */
export const CYCLE_MESSAGE_COUNT = 10;

/** Text in the newest message; the first-readable probe waits for it on screen. */
export const LAST_MESSAGE_MARKER = 'E2E-LONG-LIST-NEWEST-MESSAGE';

/** Static asset served by the app itself, so image rows never hit the network. */
export const IMAGE_FIXTURE_PATH = '/screenshots/shot-1.desktop.png';

export interface LongConversationIds {
  agentId: string;
  topicId: string;
  userId: string;
}

export interface SeedMessageRow {
  agentId: string;
  content: string;
  createdAt: Date;
  id: string;
  parentId: string | null;
  role: 'assistant' | 'tool' | 'user';
  tools: SeedToolCall[] | null;
  topicId: string;
  userId: string;
}

export interface SeedToolCall {
  apiName: string;
  arguments: string;
  id: string;
  identifier: string;
  type: 'builtin';
}

export interface SeedPluginRow {
  apiName: string;
  arguments: string;
  id: string;
  identifier: string;
  toolCallId: string;
  type: 'builtin';
  userId: string;
}

export interface LongConversationRows {
  lastMessageId: string;
  messages: SeedMessageRow[];
  plugins: SeedPluginRow[];
}

const CODE_BLOCK = [
  '```ts',
  'interface Invoice {',
  '  amount: number;',
  '  currency: string;',
  '  dueAt: Date;',
  '}',
  '',
  'export const totalByCurrency = (invoices: Invoice[]) => {',
  '  const totals = new Map<string, number>();',
  '  for (const invoice of invoices) {',
  '    totals.set(invoice.currency, (totals.get(invoice.currency) ?? 0) + invoice.amount);',
  '  }',
  '  return Object.fromEntries(totals);',
  '};',
  '```',
].join('\n');

const PARAGRAPH =
  'Virtualized lists only mount the rows near the viewport, so the cost of a long ' +
  'conversation should stay close to the cost of a short one. This paragraph is long ' +
  'enough to wrap across several lines at the default reading width and give each row ' +
  'a realistic height.';

/**
 * Build a linear conversation of `messageCount` rows that repeats one cycle of
 * the row shapes a real long topic contains:
 *
 * | round | rows                                        | rendered as             |
 * | ----- | ------------------------------------------- | ----------------------- |
 * | tool  | user → assistant(tool call) → tool → answer | tool card + markdown    |
 * | image | user → assistant with an image and a table  | image + table           |
 * | code  | user → assistant with a code block          | highlighted code block  |
 * | text  | user → assistant with plain paragraphs      | plain markdown          |
 *
 * The cycle ends on a plain-text assistant row so the newest message renders
 * as its own `[data-message-id]` row (tool rounds collapse into one group row).
 */
export const buildLongConversationRows = (
  ids: LongConversationIds,
  messageCount: number,
  startAt: Date = new Date(Date.UTC(2026, 0, 1)),
): LongConversationRows => {
  if (messageCount <= 0 || messageCount % CYCLE_MESSAGE_COUNT !== 0) {
    throw new Error(`messageCount must be a positive multiple of ${CYCLE_MESSAGE_COUNT}`);
  }

  const messages: SeedMessageRow[] = [];
  const plugins: SeedPluginRow[] = [];
  const base = { agentId: ids.agentId, topicId: ids.topicId, userId: ids.userId };

  const push = (
    role: SeedMessageRow['role'],
    content: string,
    tools: SeedToolCall[] | null = null,
  ): SeedMessageRow => {
    const index = messages.length;
    const row: SeedMessageRow = {
      ...base,
      content,
      // One second apart keeps ordering stable for every created_at sort.
      createdAt: new Date(startAt.getTime() + index * 1000),
      id: `${ids.topicId}_msg_${String(index).padStart(5, '0')}`,
      parentId: messages.at(-1)?.id ?? null,
      role,
      tools,
    };
    messages.push(row);
    return row;
  };

  for (let cycle = 0; cycle < messageCount / CYCLE_MESSAGE_COUNT; cycle++) {
    const isLastCycle = cycle === messageCount / CYCLE_MESSAGE_COUNT - 1;

    // Tool round: 4 rows.
    push('user', `Round ${cycle}: list the files in the workspace.`);
    const toolCallId = `call_${ids.topicId}_${cycle}`;
    const toolCall: SeedToolCall = {
      apiName: 'runCommand',
      arguments: JSON.stringify({ command: 'ls -la src', description: 'List source files' }),
      id: toolCallId,
      identifier: 'lobe-cloud-sandbox',
      type: 'builtin',
    };
    push('assistant', '', [toolCall]);
    const toolRow = push(
      'tool',
      [
        'total 24',
        'drwxr-xr-x  5 user  staff  160 index.ts',
        '-rw-r--r--  1 user  staff  812 a.ts',
      ].join('\n'),
    );
    plugins.push({
      apiName: toolCall.apiName,
      arguments: toolCall.arguments,
      id: toolRow.id,
      identifier: toolCall.identifier,
      toolCallId,
      type: 'builtin',
      userId: ids.userId,
    });
    push(
      'assistant',
      `The workspace has **3** entries in round ${cycle}:\n\n- index.ts\n- a.ts\n- b.ts`,
    );

    // Image round: 2 rows.
    push('user', `Round ${cycle}: show me the dashboard screenshot.`);
    push(
      'assistant',
      [
        `Here is the dashboard for round ${cycle}:`,
        '',
        `![Dashboard screenshot](${IMAGE_FIXTURE_PATH})`,
        '',
        '| Metric | Value |',
        '| ------ | ----- |',
        '| Users  | 1,024 |',
        '| Errors | 3     |',
      ].join('\n'),
    );

    // Code round: 2 rows.
    push('user', `Round ${cycle}: write a helper that sums invoices by currency.`);
    push('assistant', `Here is a helper:\n\n${CODE_BLOCK}`);

    // Plain text round: 2 rows.
    push('user', `Round ${cycle}: ${PARAGRAPH}`);
    push(
      'assistant',
      `${PARAGRAPH}\n\n${PARAGRAPH}${isLastCycle ? `\n\n${LAST_MESSAGE_MARKER}` : ''}`,
    );
  }

  return { lastMessageId: messages.at(-1)!.id, messages, plugins };
};

/** Rows per multi-row INSERT; 10 columns × 200 rows stays well under the 65535 bind limit. */
const INSERT_BATCH_SIZE = 200;

interface QueryableClient {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}

const insertBatched = async <T>(
  client: QueryableClient,
  rows: T[],
  table: string,
  columns: string[],
  toValues: (row: T) => unknown[],
) => {
  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE);
    const values: unknown[] = [];
    const tuples = batch.map((row) => {
      const rowValues = toValues(row);
      const placeholders = rowValues.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    // Batches are sequential on purpose: one pg client cannot pipeline queries.
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`,
      values,
    );
  }
};

/**
 * Replace the long topic of `ids` with a fresh copy of `messageCount` rows.
 * Re-seeding per scenario keeps the topic identical across runs and workers.
 */
export const seedLongConversation = async (
  ids: LongConversationIds,
  messageCount: number,
): Promise<LongConversationRows> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to seed the long conversation');

  const rows = buildLongConversationRows(ids, messageCount);
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO agents (id, slug, title, user_id, model, provider)
       VALUES ($1, $2, 'Long List Budget', $3, 'gpt-4o-mini', 'openai')
       ON CONFLICT (id) DO NOTHING`,
      [ids.agentId, ids.agentId, ids.userId],
    );
    // Cascades to messages and message_plugins.
    await client.query('DELETE FROM topics WHERE id = $1', [ids.topicId]);
    await client.query(
      `INSERT INTO topics (id, title, user_id, agent_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [
        ids.topicId,
        `Long list ${messageCount}`,
        ids.userId,
        ids.agentId,
        rows.messages.at(-1)!.createdAt,
      ],
    );

    await insertBatched(
      client,
      rows.messages,
      'messages',
      [
        'id',
        'role',
        'content',
        'tools',
        'user_id',
        'topic_id',
        'agent_id',
        'parent_id',
        'created_at',
        'updated_at',
      ],
      (row) => [
        row.id,
        row.role,
        row.content,
        row.tools ? JSON.stringify(row.tools) : null,
        row.userId,
        row.topicId,
        row.agentId,
        row.parentId,
        row.createdAt,
        row.createdAt,
      ],
    );
    await insertBatched(
      client,
      rows.plugins,
      'message_plugins',
      ['id', 'tool_call_id', 'type', 'api_name', 'arguments', 'identifier', 'user_id'],
      (row) => [
        row.id,
        row.toolCallId,
        row.type,
        row.apiName,
        row.arguments,
        row.identifier,
        row.userId,
      ],
    );

    await client.query('COMMIT');
    return rows;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
};
