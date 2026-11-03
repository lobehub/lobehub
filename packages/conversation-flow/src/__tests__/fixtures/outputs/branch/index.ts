import type { SerializedParseResult } from '../..';
import activeIndex1 from './active-index-1.json';
import assistantBranch from './assistant-branch.json';
import assistantGroupBranches from './assistant-group-branches.json';
import assistantUserBranch from './assistant-user-branch.json';
import conversation from './conversation.json';
import multiAssistantGroup from './multi-assistant-group.json';
import nested from './nested.json';

export const branch = {
  activeIndex1: activeIndex1 as unknown as SerializedParseResult,
  assistantBranch: assistantBranch as unknown as SerializedParseResult,
  assistantGroupBranches: assistantGroupBranches as unknown as SerializedParseResult,
  assistantUserBranch: assistantUserBranch as unknown as SerializedParseResult,
  conversation: conversation as unknown as SerializedParseResult,
  multiAssistantGroup: multiAssistantGroup as unknown as SerializedParseResult,
  nested: nested as unknown as SerializedParseResult,
};
