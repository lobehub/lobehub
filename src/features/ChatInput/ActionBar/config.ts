import AgentMode from './AgentMode';
import Clear from './Clear';
import History from './History';
import Mention from './Mention';
import Model from './Model';
import Params from './Params';
import SaveTopic from './SaveTopic';
import Search from './Search';
import STT from './STT';
import { MainToken, PortalToken } from './Token';
import Tools from './Tools';
import Typo from './Typo';
import Upload from './Upload';

export const actionMap = {
  agentMode: AgentMode,
  clear: Clear,
  fileUpload: Upload,
  history: History,
  mainToken: MainToken,
  mention: Mention,
  model: Model,
  params: Params,
  portalToken: PortalToken,
  saveTopic: SaveTopic,
  search: Search,
  stt: STT,
  temperature: Params,
  tools: Tools,
  typo: Typo,
} as const;

export type ActionKey = keyof typeof actionMap;

export type ActionKeys = ActionKey | ActionKey[] | '---';
