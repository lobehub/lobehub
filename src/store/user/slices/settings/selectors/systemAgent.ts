import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@/const/settings';
import { type UserStore } from '@/store/user';
import { merge } from '@/utils/merge';

import { currentSettings } from './settings';

const currentSystemAgent = (s: UserStore) =>
  merge(DEFAULT_SYSTEM_AGENT_CONFIG, currentSettings(s).systemAgent);

const translation = (s: UserStore) => currentSystemAgent(s).translation;
const asr = (s: UserStore) => currentSystemAgent(s).asr;
const isAsrConfigured = (s: UserStore) => {
  const { model, provider } = asr(s);

  return !!model && !!provider;
};
const topic = (s: UserStore) => currentSystemAgent(s).topic;
const topicAutoSummary = (s: UserStore) => currentSystemAgent(s).topicAutoSummary;
const thread = (s: UserStore) => currentSystemAgent(s).thread;
const agentMeta = (s: UserStore) => currentSystemAgent(s).agentMeta;
const promptRewrite = (s: UserStore) => currentSystemAgent(s).promptRewrite;
const historyCompress = (s: UserStore) => currentSystemAgent(s).historyCompress;
const generationTopic = (s: UserStore) => currentSystemAgent(s).generationTopic;
const inputCompletion = (s: UserStore) => currentSystemAgent(s).inputCompletion;
const followUpAction = (s: UserStore) => currentSystemAgent(s).followUpAction;
const goal = (s: UserStore) => currentSystemAgent(s).goal;
const expertise = (s: UserStore) => currentSystemAgent(s).expertise;

export const systemAgentSelectors = {
  agentMeta,
  asr,
  expertise,
  followUpAction,
  generationTopic,
  goal,
  historyCompress,
  inputCompletion,
  isAsrConfigured,
  promptRewrite,
  thread,
  topic,
  topicAutoSummary,
  translation,
};
