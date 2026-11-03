import type { Message } from '../../../../types';
import assistantWithTools from './assistant-with-tools.json';
import toolsWithBranches from './tools-with-branches.json';

export const assistantGroup = {
  assistantWithTools: assistantWithTools as Message[],
  toolsWithBranches: toolsWithBranches as Message[],
};
