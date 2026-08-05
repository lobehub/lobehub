import AgentMode from './AgentMode';
import Clear from './Clear';
import History from './History';
import Memory from './Memory';
import Mention from './Mention';
import Model from './Model';
import ModelLabel from './ModelLabel';
import Params from './Params';
import Plus from './Plus';
import PromptTransform from './PromptTransform';
import Search from './Search';
import ContextWindow from './Token';
import Tools from './Tools';
import Typo from './Typo';
import Upload from './Upload';

export const actionMap = {
  agentMode: AgentMode,
  clear: Clear,
  contextWindow: ContextWindow,
  fileUpload: Upload,
  plus: Plus,
  history: History,
  memory: Memory,
  mention: Mention,
  model: Model,
  modelLabel: ModelLabel,
  params: Params,
  promptTransform: PromptTransform,
  search: Search,
  temperature: Params,
  tools: Tools,
  typo: Typo,
} as const;

export type ActionKey = keyof typeof actionMap;

export type ActionKeys = ActionKey | ActionKey[] | '---';
