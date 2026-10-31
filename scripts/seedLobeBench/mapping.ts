/**
 * Lobe Bench release → database rows.
 *
 * The bench engine serves one immutable Release of the case catalog: `GET /cases` is the
 * engine's own view of every case (prompt, agent prompt, clock, connectors, Memory fixture,
 * grading rules) and `GET /services` names the mock connectors. This module turns that into
 * the rows the product keeps: one shared environment per distinct "world" (system role,
 * Memory settings and fixture, clock) and one test case per catalog case that carries only
 * its own connectors on top. Same split as the account-level importer in the eval
 * workspace (`reports/lobe-bench-20261021/import-*.ts`), kept here so the product can seed
 * its built-in case sets without that workspace.
 */
import { createHash } from 'node:crypto';

export type Env = Record<string, any>;

export interface EngineService {
  description?: string;
  identifier: string;
  kind: string;
  label?: string;
  service: string;
}

export interface EngineCase {
  agentPrompt?: string;
  caseId: string;
  category?: string;
  clock?: { sessionDate?: string; timezone?: string };
  criteria: string | string[];
  difficulty?: { level?: string; score?: number; signals?: string[] };
  followUpTurns?: string[];
  index: number;
  level?: string;
  memory?: {
    agent?: { effort?: string; enabled: boolean; toolPermission?: string } | null;
    benchmarkFixture?: { records?: { capturedAt?: string; createdAt?: string }[] };
    records?: Record<string, unknown[]>;
  };
  prompt: string;
  seedMessages?: { content: string; role: string }[];
  services: { identifier: string; kind: string; role?: string; service: string }[];
  sessionDate?: string;
  title: string;
}

/** Memory is the product's own runtime, never installed as a connector. */
const PRODUCT_MEMORY = 'lobe-user-memory';
/** Engine ids that collide with a product builtin id are installed under another name. */
export const CONNECTOR_RENAMES: Record<string, string> = {
  'lobe-acp': 'acp-eval-mcp',
  'lobe-cron': 'cron-eval-mcp',
};
/** Product builtins keep their own manifest; everything else is installed as a custom MCP plugin. */
export const PRODUCT_BUILTINS = new Set([
  'lobe-agent-documents',
  'lobe-agent-management',
  'lobe-cloud-sandbox',
  'lobe-creds',
  'lobe-image-generation',
  'lobe-knowledge-base',
  'lobe-local-system',
  'lobe-remote-device',
  'lobe-skill-store',
  'lobe-skills',
  'lobe-web-browsing',
]);
const HARNESS_SEEDED_AT = '2026-07-20T00:00:00.000Z';

export const connectorId = (id: string) => CONNECTOR_RENAMES[id] ?? id;

/** The connectors a case wires up: everything the engine lists except Memory and unknown `lobe-*` ids. */
export const pluginsOf = (c: EngineCase) =>
  c.services
    .map((s) => connectorId(s.identifier))
    .filter((id) => id !== PRODUCT_MEMORY)
    .filter((id) => !id.startsWith('lobe-') || PRODUCT_BUILTINS.has(id));

/** Names and descriptions of the mock connectors a case set installs (benchmark/dataset `metadata.mock.connectors`). */
export const connectorsOf = (cases: EngineCase[], services: EngineService[]) => {
  const byId = new Map(services.map((s) => [connectorId(s.identifier), s]));
  const needed = [...new Set(cases.flatMap(pluginsOf))].filter((id) => !PRODUCT_BUILTINS.has(id));
  return Object.fromEntries(
    needed.map((id) => {
      const service = byId.get(id);
      return [
        id,
        {
          ...(service?.description && { description: service.description }),
          ...(service?.label && { title: service.label }),
        },
      ];
    }),
  );
};

// ---- environment split (shared world vs the case's own connectors) ------------------------

const stable = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value as object)
            .sort()
            .map((k) => [k, stable((value as any)[k])]),
        )
      : value;

/** Ten hex chars of the shared part's canonical JSON; the environment row's identifier is `env-<fingerprint>`. */
export const fingerprint = (shared: Env) =>
  createHash('sha1')
    .update(JSON.stringify(stable(shared)))
    .digest('hex')
    .slice(0, 10);

export const splitEnvironment = (env: Env) => {
  const { agent = {}, mock, sessionDate, timezone, ...rest } = env;
  // An empty connector list describes the world (no connectors), so it stays shared.
  const { plugins, ...agentShared } = agent;
  const ownPlugins = Array.isArray(plugins) && plugins.length > 0 ? plugins : undefined;
  if (plugins && !ownPlugins) agentShared.plugins = plugins;
  const shared: Env = {
    ...rest,
    ...(sessionDate !== undefined && { sessionDate }),
    ...(timezone !== undefined && { timezone }),
    ...(Object.keys(agentShared).length ? { agent: agentShared } : {}),
  };
  const own: Env = {
    ...(ownPlugins ? { agent: { plugins: ownPlugins } } : {}),
    ...(mock ? { mock } : {}),
  };
  return { own, shared };
};

const roleLabel = (systemRole?: string) => {
  const first =
    (systemRole ?? '')
      .split('\n')
      .find((l) => l.trim())
      ?.trim() ?? '';
  if (!first) return 'No system role';
  if (/^You are Lobe, an AI Agent/i.test(first)) {
    const extra = (systemRole ?? '')
      .split(/Respond in the same language the user is using\.?/)[1]
      ?.split('\n')
      .map((l) => l.replace(/^#+\s*/, '').trim())
      .find(Boolean);
    if (!extra) return 'Lobe default';
    const label = extra.split(/[.:]/)[0].trim();
    return `Lobe default + ${label.length > 40 ? `${label.slice(0, 37)}…` : label}`;
  }
  const heading = first
    .replace(/^#+\s*/, '')
    .split(/\s[—–-]\s/)[0]
    .trim();
  return heading.length > 48 ? `${heading.slice(0, 45)}…` : heading;
};

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** A readable name and description for an environment row built from `shared`. */
export const describeEnvironment = (shared: Env) => {
  const memoryCfg = shared.agent?.memory;
  const records = shared.memory ?? {};
  const kinds = Object.entries(records)
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([k, v]) => count((v as unknown[]).length, k.replace(/s$/, '')));
  const memoryLabel = !memoryCfg?.enabled
    ? 'no Memory'
    : `Memory ${memoryCfg.toolPermission ?? 'read-only'}${memoryCfg.effort ? ` · effort ${memoryCfg.effort}` : ''} (${kinds.length ? kinds.join(', ') : 'blank'})`;
  const name = `${roleLabel(shared.agent?.systemRole)} · ${memoryLabel}`;
  const headline = Object.values(records)
    .flatMap((v) => (Array.isArray(v) ? v : []))
    .map((r: any) => r?.content ?? r?.text ?? r?.summary ?? r?.details)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => String(s).slice(0, 90))
    .join(' / ');
  const clock = shared.sessionDate
    ? `Session date ${shared.sessionDate}${shared.timezone ? ` ${shared.timezone}` : ''}.`
    : '';
  const description = [clock, headline && `Memory: ${headline}`].filter(Boolean).join(' ');
  return { description, name };
};

// ---- case rows -----------------------------------------------------------------------------

export interface CaseRow {
  content: Record<string, unknown>;
  evalConfig: Record<string, unknown>;
  evalMode: 'rule-checklist';
  metadata: Record<string, unknown>;
  /** The shared environment this case runs in. */
  shared: Env;
  sortOrder: number;
}

/** One case of the engine → its row (minus the environment id, resolved from `shared`'s fingerprint). */
export const toCaseRow = (c: EngineCase, judge: Record<string, unknown>): CaseRow => {
  const plugins = pluginsOf(c);
  const multiTurn = (c.followUpTurns?.length ?? 0) > 0;
  const rules = (Array.isArray(c.criteria) ? c.criteria : c.criteria.split('\n'))
    .map((l) => l.trim())
    .filter(Boolean);
  if (rules.length === 0) throw new Error(`case ${c.index} ${c.caseId} has no rules`);
  const agentMemory = c.memory?.agent;
  const records = c.memory?.records;
  const hasRecords =
    !!records && Object.values(records).some((v) => Array.isArray(v) && v.length > 0);
  const seed = c.memory?.benchmarkFixture?.records?.[0];
  const history = c.seedMessages?.filter((m) => m.role === 'user' || m.role === 'assistant');

  const environment: Env = {
    agent: {
      plugins,
      systemRole: c.agentPrompt ?? c.prompt,
      ...(agentMemory?.enabled && {
        memory: {
          enabled: true,
          toolPermission: agentMemory.toolPermission === 'read-write' ? 'read-write' : 'read-only',
          ...(agentMemory.effort && { effort: agentMemory.effort }),
        },
      }),
    },
    sessionDate: c.clock?.sessionDate ?? c.sessionDate,
    ...(c.clock?.timezone && { timezone: c.clock.timezone }),
    // Endpoints are derived at run time from the benchmark's / case set's metadata.mock.
    mock: { services: plugins },
  };
  if (agentMemory?.enabled && hasRecords) {
    environment.memory = {
      ...records,
      seededAt: seed?.createdAt ?? seed?.capturedAt ?? HARNESS_SEEDED_AT,
    };
  }
  const { own, shared } = splitEnvironment(environment);
  return {
    content: {
      ...(Object.keys(own).length ? { environment: own } : {}),
      input: c.prompt,
      ...(history?.length ? { messages: history } : {}),
    },
    evalConfig: { judgePrompt: rules.join('\n'), ...judge },
    evalMode: 'rule-checklist',
    metadata: {
      caseId: c.caseId,
      category: c.category,
      ...(c.difficulty && { difficulty: c.difficulty }),
      index: c.index,
      ...(c.level && { level: c.level }),
      multiTurn,
      services: c.services.filter((s) => s.role === 'expected').map((s) => s.service),
      title: c.title,
      ...(multiTurn && {
        note: 'The benchmark has a follow-up turn; this run grades the first turn only.',
      }),
    },
    shared,
    sortOrder: c.index - 1,
  };
};
