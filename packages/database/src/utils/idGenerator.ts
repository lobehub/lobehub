// generate('1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 16); //=> "4f90d13a42"
import { customAlphabet } from 'nanoid/non-secure';
import { generate } from 'random-words';

export const createNanoId = (size = 8) =>
  customAlphabet('1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', size);

const prefixes = {
  connectorLinks: 'lnk',
  agentCronJobs: 'cron',
  agentSkills: 'skl',
  agentHistoryJobs: 'ahj',
  briefs: 'brf',
  taskComments: 'cmt',
  tasks: 'task',
  agents: 'agt',
  artboardGroups: 'abg',
  artboardPages: 'abp',
  artboards: 'art',
  budget: 'bgt',
  channelThreads: 'cht',
  channels: 'chn',
  chatGroups: 'cg',
  customEmojis: 'emj',
  documents: 'docs',
  emojiPacks: 'epk',
  evalBenchmarks: 'evb',
  evalDatasets: 'ds',
  evalExperiments: 'exp',
  evalRuns: 'run',
  evalTestCases: 'case',
  expertiseDomains: 'epd',
  files: 'file',
  collections: 'col',
  generationBatches: 'gb',
  generationTopics: 'gt',
  generations: 'gen',
  goals: 'goal',
  knowledgeBases: 'kb',
  memory: 'mem',
  messageGroups: 'mg',
  messages: 'msg',
  metrics: 'mtr',
  plugins: 'plg',
  projects: 'prj',
  projectSites: 'psite',
  scmChangeRequests: 'scr',
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
/**
 * Share-link ids act as bearer tokens in public URLs, so unlike internal ids
 * they must come from the platform CSPRNG and carry enough entropy to resist
 * enumeration. 16 random bytes encode to 22 base64url chars (128 bits).
 *
 * Stored ids are looked up verbatim, so links issued before this change with
 * shorter non-secure ids keep working — this only hardens newly issued shares.
 */
export const generateShareToken = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');

export const randomSlug = (count = 2) => (generate(count) as string[]).join('-');

export const inboxSessionId = (userId: string) => `ssn_inbox_${userId}`;
