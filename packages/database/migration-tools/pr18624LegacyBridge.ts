import { sql } from 'drizzle-orm';

/** The small executor surface needed by the explicit legacy bridge. */
export interface Pr18624BridgeDatabase {
  execute: (query: unknown) => Promise<{ rows?: unknown[] }>;
  transaction?: <T>(callback: (transaction: Pr18624BridgeDatabase) => Promise<T>) => Promise<T>;
}

export interface Pr18624MigrationFile {
  folderMillis: number;
  hash: string;
  sql: string[];
  tag: string;
}

export interface Pr18624MigrationRecord {
  created_at: number | string;
  hash: string;
}

export interface Pr18624KnownLaterMigration {
  sha256: string;
  when: number;
}

export const PR18624_LEGACY_MIGRATIONS = [
  {
    idx: 149,
    tag: '0149_add_document_annotations',
    when: 1787715658273,
    sha256: '7348eb92f08790105222984b837015447728217201e6019447454a91fdee9c79',
  },
  {
    idx: 150,
    tag: '0150_document_rewrite_requests',
    when: 1787943185174,
    sha256: '463f385ba5c4fdfdb61249cf0a284c0932f8cc81860d172366775fea60a9f05c',
  },
  {
    idx: 151,
    tag: '0151_document_collaboration_states',
    when: 1787989549154,
    sha256: '8d40da7976d81a7f2e48413b09e33056c341ab45f16bd953b6f32d3f8cd83f6a',
  },
  {
    idx: 152,
    tag: '0152_document_collaboration_history_metadata',
    when: 1787990484290,
    sha256: '8e0e4d4e63535742e4395af404bcb2738fae30a8a231762311a67b3db6c94903',
  },
  {
    idx: 153,
    tag: '0153_document_rewrite_target_overlap',
    when: 1788221508419,
    sha256: '9f60319fb66c720093f91e4f735108ab3858fd57b99773e928f533bd0d2a858a',
  },
  {
    idx: 154,
    tag: '0154_document_rewrite_sessions',
    when: 1788230000000,
    sha256: 'b227a7e7eb2236a2381635df0931501030126bfb1b80165fc21db2159be82cb1',
    acceptedSha256: ['0abee247c0b878356b1f169baeb693ebbaececbcff2e0c9a204e733cdd5fc2cc'],
  },
  {
    idx: 155,
    tag: '0155_document_rewrite_progress',
    when: 1788231000000,
    sha256: 'c980b144b32fbb14e3698afc9604a53e60a98501c019aa866e6db15cf5da936e',
  },
  {
    idx: 156,
    tag: '0156_document_rewrite_requested_model',
    when: 1788232000000,
    sha256: 'f14e14787c18b7313a7466237c9cd00d332b760001228df76352edcd29890cb1',
  },
  {
    idx: 157,
    tag: '0157_document_collaboration_snapshot_update',
    when: 1788575797078,
    sha256: '927501f3b29a9d7291de0a13b27a5eb0e2e54d3dec4b0a5c79894be30754434a',
  },
] as const;

/** Canary migrations that a legacy PR18624 database skipped by timestamp. */
export const PR18624_CANARY_BRIDGE_MIGRATIONS = [
  {
    idx: 149,
    tag: '0149_goals_recovery_and_document_evidence',
    when: 1787542746291,
    sha256: 'a2fe520f2c9aa08da253491f0dc768673012b8d0b0c7bcd58a885a67b16993be',
  },
  {
    idx: 150,
    tag: '0150_agent_interventions_and_live_activity',
    when: 1787736410876,
    sha256: '70243ea02a3cd3280806123a709f76af07960ec654b8885f44dcc64dfad6e2d6',
  },
  {
    idx: 151,
    tag: '0151_document_comments',
    when: 1787815769048,
    sha256: '57ebe2e38e37c35c88982c5ccb84a32fb1abe48b3f1db3ee8e5e4962b352d10e',
  },
  {
    idx: 152,
    tag: '0152_trash_goal_traces_eval_dataset',
    when: 1788016606062,
    sha256: '1d501a5d1524c70b6b559f56cd1bf366c924942f04093597f0b82722a0977f8e',
  },
  {
    idx: 153,
    tag: '0153_fts_search_sync_outbox',
    when: 1788108760793,
    sha256: '8f28588f456f1db16ca160725b66f0b06785313685f2cfa31fd74569cfda72ef',
  },
  {
    idx: 154,
    tag: '0154_goal_node_task_kind',
    when: 1788141397076,
    sha256: '1a3533158e3ac3a6ff59a32a8822d345d7e1a7c0dfb0d1ad45060c987c2745a5',
  },
  {
    idx: 155,
    tag: '0155_document_likes',
    when: 1788177029327,
    sha256: 'a622be83996fe3bb697ff4a1a4cdc0db1b01c367c31e036c52b015f3619c417d',
  },
  {
    idx: 156,
    tag: '0156_project_working_directories',
    when: 1788281814640,
    sha256: 'ec046a723a52a123dca37a89bdc3d367c239c6257e75b2f545a10fa2a1d248cf',
  },
  {
    idx: 157,
    tag: '0157_add_metrics_tables',
    when: 1788399005304,
    sha256: '226afa6341a1b59d6123b2c8c745e52c1d3201048f9786aa499b0ccd7cfc8a32',
  },
  {
    idx: 158,
    tag: '0158_file_upload_reservations',
    when: 1788457369087,
    sha256: 'e99830a833a27abbf8a6d44f440375891f14c092e4b94f3c16fc614e3c78219d',
  },
] as const;

export const PR18624_CANARY_TAIL_MIGRATIONS = [
  {
    idx: 159,
    tag: '0159_task_activities',
    when: 1788751998345,
    sha256: '4208937254b4618f2c985c0e9cf7f82a279e129350241d6a6f99ed6cdcc0ee05',
  },
  {
    idx: 160,
    tag: '0160_acceptance_check_assets',
    when: 1788849739068,
    sha256: 'deed376aa6e4aa7abd0b9e89aaf62bf35c1b06857fc76a2966198802282bbb9f',
  },
  {
    idx: 161,
    tag: '0161_acceptance_comments',
    when: 1789038060245,
    sha256: '2bc76dfd05a525a53706390ad97f6c8868ab459a5b16fc68f215e5e479714aec',
  },
] as const;

const NON_TRANSACTIONAL_SQL =
  /\b(?:CONCURRENTLY|VACUUM|REINDEX\s+CONCURRENTLY|CREATE\s+DATABASE)\b/i;

const rowsFrom = (result: { rows?: unknown[] }): Record<string, unknown>[] =>
  (result.rows ?? []).filter(
    (row): row is Record<string, unknown> => typeof row === 'object' && row !== null,
  );

const createdAt = (record: Pr18624MigrationRecord): number => Number(record.created_at);

const sameMigration = (
  record: Pr18624MigrationRecord,
  expected: { acceptedSha256?: readonly string[]; sha256: string; when: number },
): boolean =>
  createdAt(record) === expected.when &&
  [expected.sha256, ...(expected.acceptedSha256 ?? [])].includes(record.hash);

export type Pr18624HistoryKind = 'clean' | 'legacy';

/**
 * Classify only the known old PR lineage. Any partial or altered lineage fails
 * closed so a database with an unknown history cannot be treated as legacy.
 */
export const classifyPr18624History = (
  records: readonly Pr18624MigrationRecord[],
  knownLaterMigrations: readonly Pr18624KnownLaterMigration[] = [],
): Pr18624HistoryKind => {
  const knownTimes = new Set<number>(PR18624_LEGACY_MIGRATIONS.map((migration) => migration.when));
  const recordsAtKnownTimes = records.filter((record) => knownTimes.has(createdAt(record)));
  const matching = PR18624_LEGACY_MIGRATIONS.filter((migration) =>
    records.some((record) => sameMigration(record, migration)),
  );

  if (recordsAtKnownTimes.length === 0 && matching.length === 0) return 'clean';
  if (matching.length !== PR18624_LEGACY_MIGRATIONS.length) {
    throw new Error('PR18624 legacy migration history is partial or unknown');
  }
  for (const record of recordsAtKnownTimes) {
    const expected = PR18624_LEGACY_MIGRATIONS.find(
      (migration) => migration.when === createdAt(record),
    );
    if (!expected || !sameMigration(record, expected)) {
      throw new Error('PR18624 legacy migration history hash mismatch');
    }
  }

  const allowedAfterLegacy = [
    ...PR18624_CANARY_BRIDGE_MIGRATIONS,
    ...PR18624_CANARY_TAIL_MIGRATIONS,
    ...knownLaterMigrations,
  ];
  for (const record of records) {
    if (createdAt(record) <= Math.max(...PR18624_LEGACY_MIGRATIONS.map((m) => Number(m.when))))
      continue;
    const expected = allowedAfterLegacy.find((migration) => migration.when === createdAt(record));
    if (!expected || record.hash !== expected.sha256) {
      throw new Error('PR18624 legacy migration history contains an unknown later migration');
    }
  }
  return 'legacy';
};

const validateCanaryFiles = (files: readonly Pr18624MigrationFile[]): Pr18624MigrationFile[] => {
  return PR18624_CANARY_BRIDGE_MIGRATIONS.map((expected) => {
    const file = files.find((candidate) => candidate.tag === expected.tag);
    if (!file || file.folderMillis !== expected.when || file.hash !== expected.sha256) {
      throw new Error(`PR18624 canary migration artifact mismatch: ${expected.tag}`);
    }
    if (file.sql.some((statement) => NON_TRANSACTIONAL_SQL.test(statement))) {
      throw new Error(`PR18624 canary bridge contains non-transactional SQL: ${expected.tag}`);
    }
    return file;
  });
};

interface ColumnShape {
  dataType: string;
  nullable: boolean;
  udtName: string;
}

const column = (dataType: string, udtName: string, nullable: boolean): ColumnShape => ({
  dataType,
  nullable,
  udtName,
});

const schemaColumnShapes: Record<string, Record<string, ColumnShape>> = {
  document_annotations: {
    id: column('character varying', 'varchar', false),
    document_id: column('character varying', 'varchar', false),
    user_id: column('text', 'text', false),
    author: column('jsonb', 'jsonb', true),
    kind: column('text', 'text', false),
    payload: column('jsonb', 'jsonb', true),
    quoted_text: column('text', 'text', false),
    status: column('text', 'text', false),
    anchor_metadata: column('jsonb', 'jsonb', true),
    version: column('integer', 'int4', false),
    created_at: column('timestamp with time zone', 'timestamptz', false),
    updated_at: column('timestamp with time zone', 'timestamptz', false),
  },
  document_collaboration_states: {
    document_id: column('character varying', 'varchar', false),
    room_id: column('character varying', 'varchar', false),
    workspace_id: column('text', 'text', true),
    user_id: column('text', 'text', false),
    room_revision: column('integer', 'int4', false),
    state_vector: column('text', 'text', false),
    version_token: column('character varying', 'varchar', false),
    document_updated_at: column('timestamp with time zone', 'timestamptz', false),
    snapshot_update: column('text', 'text', true),
    created_at: column('timestamp with time zone', 'timestamptz', false),
    updated_at: column('timestamp with time zone', 'timestamptz', false),
  },
  document_rewrite_requests: {
    id: column('character varying', 'varchar', false),
    document_id: column('character varying', 'varchar', false),
    workspace_id: column('text', 'text', true),
    requested_by_user_id: column('text', 'text', false),
    agent_id: column('text', 'text', false),
    operation_id: column('text', 'text', true),
    topic_id: column('text', 'text', true),
    tool_call_id: column('text', 'text', true),
    instruction: column('text', 'text', false),
    selection: column('jsonb', 'jsonb', false),
    quoted_text: column('text', 'text', false),
    target_key: column('character varying', 'varchar', true),
    target_node_ids: column('ARRAY', '_text', false),
    status: column('text', 'text', false),
    attempt: column('integer', 'int4', false),
    version: column('integer', 'int4', false),
    generation_id: column('text', 'text', true),
    model: column('text', 'text', true),
    provider: column('text', 'text', true),
    requested_model: column('text', 'text', true),
    requested_provider: column('text', 'text', true),
    last_command_id: column('text', 'text', true),
    output_text: column('text', 'text', true),
    progress: column('jsonb', 'jsonb', true),
    error_code: column('character varying', 'varchar', true),
    error_message: column('text', 'text', true),
    cancel_requested_at: column('timestamp with time zone', 'timestamptz', true),
    expires_at: column('timestamp with time zone', 'timestamptz', true),
    next_attempt_at: column('timestamp with time zone', 'timestamptz', true),
    terminal_at: column('timestamp with time zone', 'timestamptz', true),
    claim_owner: column('character varying', 'varchar', true),
    claimed_at: column('timestamp with time zone', 'timestamptz', true),
    lease_expires_at: column('timestamp with time zone', 'timestamptz', true),
    session_id: column('character varying', 'varchar', false),
    parent_request_id: column('character varying', 'varchar', true),
    turn_index: column('integer', 'int4', false),
    created_at: column('timestamp with time zone', 'timestamptz', false),
    updated_at: column('timestamp with time zone', 'timestamptz', false),
  },
  document_histories: {
    request_id: column('text', 'text', true),
    source: column('text', 'text', true),
  },
};

const schemaColumns: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(schemaColumnShapes).map(([table, columns]) => [table, Object.keys(columns)]),
);

const schemaIndexes: Record<string, readonly string[]> = {
  document_annotations: [
    'document_annotations_document_id_id_unique',
    'document_annotations_document_id_created_at_id_idx',
    'document_annotations_document_id_status_idx',
    'document_annotations_user_id_idx',
  ],
  document_collaboration_states: [
    'document_collaboration_states_room_id_idx',
    'document_collaboration_states_workspace_id_idx',
    'document_collaboration_states_user_id_idx',
  ],
  document_rewrite_requests: [
    'document_rewrite_requests_document_status_idx',
    'document_rewrite_requests_status_next_attempt_idx',
    'document_rewrite_requests_agent_status_idx',
    'document_rewrite_requests_claim_lease_idx',
    'document_rewrite_requests_user_created_at_idx',
    'document_rewrite_requests_target_node_ids_gin_idx',
    'document_rewrite_requests_document_session_turn_idx',
    'document_rewrite_requests_parent_idx',
  ],
  document_histories: ['document_histories_document_source_request_unique'],
};

const canaryBridgeTables = [
  'agent_intervention_resolutions',
  'agent_interventions',
  'push_live_activities',
  'document_comment_mentions',
  'document_comments',
  'goal_traces',
  'trash_items',
  'fts_search_sync_outbox',
  'goal_nodes',
  'document_likes',
  'project_working_directories',
  'metric_points',
  'metrics',
  'file_uploads',
];

const indexDefinitions: Record<string, RegExp> = {
  document_annotations_document_id_id_unique: /createuniqueindex.*usingbtree\(document_id,id\)/i,
  document_rewrite_requests_target_node_ids_gin_idx: /usinggin\(target_node_ids\)/i,
  document_histories_document_source_request_unique:
    /createuniqueindex.*usingbtree\(document_id,source,request_id\).*where.*request_id.*isnotnull/i,
};

const foreignKeyDefinitions: Record<string, RegExp> = {
  document_annotations_document_id_documents_id_fk:
    /foreignkey\(document_id\)references.*documents.*\(id\).*ondeletecascade/i,
  document_annotations_user_id_users_id_fk:
    /foreignkey\(user_id\)references.*users.*\(id\).*ondeletecascade/i,
  document_collaboration_states_document_id_documents_id_fk:
    /foreignkey\(document_id\)references.*documents.*\(id\).*ondeletecascade/i,
  document_collaboration_states_workspace_id_workspaces_id_fk:
    /foreignkey\(workspace_id\)references.*workspaces.*\(id\).*ondeletecascade/i,
  document_collaboration_states_user_id_users_id_fk:
    /foreignkey\(user_id\)references.*users.*\(id\).*ondeletecascade/i,
  document_rewrite_requests_document_id_documents_id_fk:
    /foreignkey\(document_id\)references.*documents.*\(id\).*ondeletecascade/i,
  document_rewrite_requests_workspace_id_workspaces_id_fk:
    /foreignkey\(workspace_id\)references.*workspaces.*\(id\).*ondeletecascade/i,
  document_rewrite_requests_requested_by_user_id_users_id_fk:
    /foreignkey\(requested_by_user_id\)references.*users.*\(id\).*ondeletecascade/i,
};

/** Fail closed when an old table exists with a partial or incompatible shape. */
export const assertPr18624SchemaShape = async (
  database: Pr18624BridgeDatabase,
  options: { includeCanaryBridgeTables?: boolean } = {},
): Promise<void> => {
  const tableNames = Object.keys(schemaColumns);
  const columns = rowsFrom(
    await database.execute(sql`
      SELECT table_name, column_name, data_type, udt_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (${sql.join(
          tableNames.map((name) => sql`${name}`),
          sql`, `,
        )})
    `),
  );
  const indexes = rowsFrom(
    await database.execute(sql`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN (${sql.join(
          tableNames.map((name) => sql`${name}`),
          sql`, `,
        )})
    `),
  );
  const constraints = rowsFrom(
    await database.execute(sql`
      SELECT conname, contype, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid IN (
        SELECT c.oid
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN (${sql.join(
            tableNames.map((name) => sql`${name}`),
            sql`, `,
          )})
      )
    `),
  );
  const presentCanaryTables = options.includeCanaryBridgeTables
    ? rowsFrom(
        await database.execute(sql`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN (${sql.join(
              canaryBridgeTables.map((name) => sql`${name}`),
              sql`, `,
            )})
        `),
      ).map((row) => String(row.table_name))
    : canaryBridgeTables;
  const missingCanaryTables = options.includeCanaryBridgeTables
    ? canaryBridgeTables.filter((name) => !presentCanaryTables.includes(name))
    : [];
  const presentColumns = new Set(
    columns.map((row) => `${String(row.table_name)}.${String(row.column_name)}`),
  );
  const presentIndexes = new Set(
    indexes.map((row) => `${String(row.tablename)}.${String(row.indexname)}`),
  );
  const missingColumns = Object.entries(schemaColumns).flatMap(([table, names]) =>
    names
      .filter((name) => !presentColumns.has(`${table}.${name}`))
      .map((name) => `${table}.${name}`),
  );
  const missingIndexes = Object.entries(schemaIndexes).flatMap(([table, names]) =>
    names
      .filter((name) => !presentIndexes.has(`${table}.${name}`))
      .map((name) => `${table}.${name}`),
  );
  const wrongColumns = Object.entries(schemaColumnShapes).flatMap(([table, shapes]) =>
    Object.entries(shapes).flatMap(([name, expected]) => {
      const row = columns.find(
        (candidate) => candidate.table_name === table && candidate.column_name === name,
      );
      if (!row) return [];
      const nullable = row.is_nullable === 'YES';
      return row.data_type !== expected.dataType ||
        row.udt_name !== expected.udtName ||
        nullable !== expected.nullable
        ? [`${table}.${name}`]
        : [];
    }),
  );
  const wrongIndexes = Object.entries(indexDefinitions).flatMap(([name, definition]) => {
    const row = indexes.find((candidate) => candidate.indexname === name);
    const normalized = String(row?.indexdef ?? '')
      .toLowerCase()
      .replaceAll('"', '')
      .replaceAll(/\s+/g, '');
    return row && definition.test(normalized) ? [] : [name];
  });
  const wrongForeignKeys = Object.entries(foreignKeyDefinitions).flatMap(([name, definition]) => {
    const row = constraints.find(
      (candidate) => candidate.conname === name && candidate.contype === 'f',
    );
    const normalized = String(row?.definition ?? '')
      .toLowerCase()
      .replaceAll('"', '')
      .replaceAll(/\s+/g, '');
    return row && definition.test(normalized) ? [] : [name];
  });
  if (
    missingColumns.length > 0 ||
    missingIndexes.length > 0 ||
    wrongColumns.length > 0 ||
    wrongIndexes.length > 0 ||
    wrongForeignKeys.length > 0 ||
    missingCanaryTables.length > 0
  ) {
    throw new Error(
      `PR18624 schema mismatch: missing columns [${missingColumns.join(', ')}], wrong columns [${wrongColumns.join(', ')}], missing indexes [${missingIndexes.join(', ')}], wrong indexes [${wrongIndexes.join(', ')}], wrong foreign keys [${wrongForeignKeys.join(', ')}], missing canary tables [${missingCanaryTables.join(', ')}]`,
    );
  }
};

const readMigrationRecords = async (
  database: Pr18624BridgeDatabase,
): Promise<Pr18624MigrationRecord[]> => {
  const result = await database.execute(
    sql`SELECT hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at ASC`,
  );
  return rowsFrom(result).map((row) => ({
    created_at: String(row.created_at),
    hash: String(row.hash),
  }));
};

export const checkPr18624LegacyHistory = async (
  database: Pr18624BridgeDatabase,
  knownLaterMigrations: readonly Pr18624KnownLaterMigration[] = [],
): Promise<Pr18624HistoryKind> =>
  classifyPr18624History(await readMigrationRecords(database), knownLaterMigrations);

/**
 * Replay the exact canary 0149–0158 SQL that timestamp ordering skips for the
 * deployed PR lineage, recording each real hash/when pair. The caller must run
 * this explicit bridge before the ordinary Drizzle runner.
 */
export const runPr18624LegacyBridge = async (
  database: Pr18624BridgeDatabase,
  files: readonly Pr18624MigrationFile[],
  knownLaterMigrations: readonly Pr18624KnownLaterMigration[] = [],
): Promise<void> => {
  const records = await readMigrationRecords(database);
  if (classifyPr18624History(records, knownLaterMigrations) !== 'legacy') {
    throw new Error('PR18624 legacy bridge requires the known deployed PR lineage');
  }
  await assertPr18624SchemaShape(database, { includeCanaryBridgeTables: false });
  const migrations = validateCanaryFiles(files);
  if (!database.transaction) throw new Error('PR18624 legacy bridge requires a transaction');

  await database.transaction(async (transaction) => {
    const transactionRecords = await readMigrationRecords(transaction);
    for (const migration of migrations) {
      const existingAtWhen = transactionRecords.find(
        (record) => createdAt(record) === migration.folderMillis,
      );
      if (existingAtWhen) {
        if (existingAtWhen.hash !== migration.hash) {
          throw new Error(`PR18624 canary migration hash mismatch: ${migration.tag}`);
        }
        continue;
      }
      for (const statement of migration.sql) {
        await transaction.execute(sql.raw(statement));
      }
      await transaction.execute(sql`
        INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
        VALUES (${migration.hash}, ${migration.folderMillis})
      `);
      transactionRecords.push({ hash: migration.hash, created_at: migration.folderMillis });
    }
  });
  await assertPr18624SchemaShape(database, { includeCanaryBridgeTables: false });
};
