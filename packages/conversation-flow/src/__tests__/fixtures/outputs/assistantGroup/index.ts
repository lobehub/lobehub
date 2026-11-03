import type { SerializedParseResult } from '../..';
import assistantWithTools from './assistant-with-tools.json';
import toolsWithBranches from './tools-with-branches.json';

export const assistantGroup = {
  assistantWithTools: assistantWithTools as unknown as SerializedParseResult,
  toolsWithBranches: toolsWithBranches as unknown as SerializedParseResult,
};
