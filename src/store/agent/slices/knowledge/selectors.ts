import { type KnowledgeItem } from '@lobechat/types';

import { type AgentStore } from '../../store';
import { agentKnowledgeListKey, type AgentKnowledgeListParams } from './projection';

/**
 * The loaded rows of one knowledge surface, or `undefined` before its first
 * paint. Read by the knowledge picker; the knowledge slice is the only writer.
 */
const getAgentKnowledgeList =
  (params?: AgentKnowledgeListParams) =>
  (s: AgentStore): KnowledgeItem[] | undefined =>
    params ? s.agentKnowledgeMap[agentKnowledgeListKey(params)] : undefined;

/** The surface is loaded and empty (not merely un-fetched). */
const isAgentKnowledgeListEmpty =
  (params?: AgentKnowledgeListParams) =>
  (s: AgentStore): boolean => {
    const list = getAgentKnowledgeList(params)(s);
    return !!list && list.length === 0;
  };

export const agentKnowledgeSelectors = {
  getAgentKnowledgeList,
  isAgentKnowledgeListEmpty,
};
