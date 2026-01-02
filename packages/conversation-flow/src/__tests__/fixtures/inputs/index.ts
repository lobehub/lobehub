import type { Message } from '../../../types';
import { agentCouncil } from './agentCouncil';
import { agentGroup } from './agentGroup';
import assistantChainWithFollowup from './assistant-chain-with-followup.json';
import { assistantGroup } from './assistantGroup';
import { branch } from './branch';
import { compare } from './compare';
import linearConversation from './linear-conversation.json';
import { tasks } from './tasks';

export const inputs = {
  agentCouncil,
  agentGroup,
  assistantChainWithFollowup: assistantChainWithFollowup as Message[],
  assistantGroup,
  branch,
  compare,
  linearConversation: linearConversation as Message[],
  tasks,
};
