import type { SerializedParseResult } from '..';
import { agentCouncil } from './agentCouncil';
import { agentGroup } from './agentGroup';
import assistantChainWithFollowup from './assistant-chain-with-followup.json';
import { assistantGroup } from './assistantGroup';
import { branch } from './branch';
import { compare } from './compare';
import { compression } from './compression';
import linearConversation from './linear-conversation.json';
import { tasks } from './tasks';

export const outputs = {
  agentCouncil,
  agentGroup,
  assistantChainWithFollowup: assistantChainWithFollowup as unknown as SerializedParseResult,
  assistantGroup,
  branch,
  compare,
  compression,
  linearConversation: linearConversation as unknown as SerializedParseResult,
  tasks,
};
