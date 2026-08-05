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
  knowledgeBases: 'kb',
  memory: 'mem',
  messageGroups: 'mg',
  messages: 'msg',
  plugins: 'plg',
  sessionGroups: 'sg',
  sessions: 'ssn',
  threads: 'thd',
  topicComments: 'tcm',
  topics: 'tpc',
  user: 'user',
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
