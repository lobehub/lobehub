// generate('1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 16); //=> "4f90d13a42"
import { customAlphabet } from 'nanoid/non-secure';
import { generate } from 'random-words';

export const createNanoId = (size = 8) =>
  customAlphabet('1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', size);

const prefixes = {
  agentCronJobs: 'cron',
  agentSkills: 'skl',
  briefs: 'brf',
  taskComments: 'cmt',
  tasks: 'task',
  accountTombs: 'tomb',
  agents: 'agt',
  budget: 'bgt',
  chatGroups: 'cg',
  documents: 'docs',
  evalBenchmarks: 'evb',
  evalDatasets: 'ds',
  evalExperiments: 'exp',
  evalRuns: 'run',
  evalTestCases: 'case',
  files: 'file',
  generationBatches: 'gb',
  generationTopics: 'gt',
  generations: 'gen',
  keyOutbox: 'kout',
  knowledgeBases: 'kb',
  memberBudgets: 'mbgt',
  memory: 'mem',
  messageGroups: 'mg',
  messages: 'msg',
  modelAccessRules: 'mar',
  organizationInvites: 'oinv',
  organizationMembers: 'omem',
  organizationTeamMembers: 'otmm',
  organizationTeams: 'oteam',
  organizations: 'org',
  orSyncRuns: 'orsr',
  platformAdmins: 'padm',
  platformAdminSessions: 'opsess',
  platformAdminUsers: 'opusr',
  plugins: 'plg',
  renewalBatches: 'rnw',
  sessionGroups: 'sg',
  sessions: 'ssn',
  threads: 'thd',
  topicComments: 'tcm',
  topics: 'tpc',
  trialAbuseBlocklist: 'tab',
  usageLogs: 'ulog',
  user: 'user',
  userPublicIds: 'upid',
  userTrials: 'utrl',
  userWallets: 'uwlt',
  walletTransactions: 'wtx',
  workspaceAuditLogs: 'wal',
  workspaceInvitations: 'wsi',
  workspaces: 'ws',
  works: 'wk',
} as const;

export const idGenerator = (namespace: keyof typeof prefixes, size = 12) => {
  const hash = createNanoId(size);
  const prefix = prefixes[namespace];

  if (!prefix) throw new Error(`Invalid namespace: ${namespace}, please check your code.`);

  return `${prefix}_${hash()}`;
};
export const randomSlug = (count = 2) => (generate(count) as string[]).join('-');

export const inboxSessionId = (userId: string) => `ssn_inbox_${userId}`;

/** Uppercase alnum public-facing code generator (never starts with `0`/`O` confusion — full charset is fine for internal use). */
const createPublicCodeSuffix = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 6);

/** Short, user-facing identifiers (e.g. `ORGAB12CD`, `USR8F3K2Q`) — distinct from internal `idGenerator` ids. */
export const generatePublicCode = (prefix: string): string =>
  `${prefix}${createPublicCodeSuffix()}`;
