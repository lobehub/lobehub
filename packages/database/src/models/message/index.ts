import type { UpdateMessageRAGParams } from '@lobechat/types';
import { inArray } from 'drizzle-orm';

import type { FtsSearchCandidateSource } from '../../repositories/ftsSearch';
import { MessageApprovalRepo } from '../../repositories/messageApproval';
import { messages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { MessageAnalyticsQueries } from './analytics';
import { MessageAnnotationMutations } from './annotation';
import { MessageBackgroundSubAgentQueries } from './backgroundSubAgent';
import { MessageBranchSnapshots } from './branchSnapshots';
import { MessageDeleteMutations } from './delete';
import { MessageLookupQueries } from './lookup';
import { MessagePluginStore } from './plugin';
import { MessageConversationQueries } from './query';
import { MessageByIdsQueries } from './queryByIds';
import { MessagePageQueries } from './queryWithWhere';
import { MessageRelationQueries } from './relations';
import type { MessageScopeArgs } from './scope';
import { MessageKeywordSearchQueries } from './search';
import { MessageSpineQueries } from './spine';
import { MessageToolMutations } from './tool';
import { MessageTrashMutations } from './trash';
import type { MessageModelOptions } from './types';
import { MessageWriteMutations } from './write';

/**
 * Message persistence model. The class composes one instance per sub-domain
 * (reads, analytics, writes, plugins, deletion, …) built on a shared
 * `MessageScope` and exposes their public methods as bound properties,
 * so callers can keep destructuring them.
 */
export class MessageModel {
  findById: MessageLookupQueries['findById'];
  findShareVisitorMessageIds: MessageLookupQueries['findShareVisitorMessageIds'];
  findByClientId: MessageLookupQueries['findByClientId'];
  findLatestAssistantMessageByThread: MessageLookupQueries['findLatestAssistantMessageByThread'];
  findVerifyMessageByOperationId: MessageLookupQueries['findVerifyMessageByOperationId'];
  findLatestAssistantByOperationId: MessageLookupQueries['findLatestAssistantByOperationId'];
  listLatestTurnAssistantContents: MessageLookupQueries['listLatestTurnAssistantContents'];
  getThreadParentMessages: MessageLookupQueries['getThreadParentMessages'];
  findMessageQueriesById: MessageLookupQueries['findMessageQueriesById'];
  queryBySessionId: MessageLookupQueries['queryBySessionId'];
  queryByKeyword: MessageLookupQueries['queryByKeyword'];
  searchInTopic: MessageLookupQueries['searchInTopic'];
  searchByKeyword: MessageKeywordSearchQueries['searchByKeyword'];

  queryByIds: MessageByIdsQueries['queryByIds'];

  queryWithWhere: MessagePageQueries['queryWithWhere'];

  queryLastUserMessageByTopics: MessageConversationQueries['queryLastUserMessageByTopics'];
  query: MessageConversationQueries['query'];
  queryForVisitor: MessageConversationQueries['queryForVisitor'];
  countByTopic: MessageConversationQueries['countByTopic'];
  queryTopicTranscript: MessageConversationQueries['queryTopicTranscript'];
  queryTopicMessageTree: MessageConversationQueries['queryTopicMessageTree'];
  queryTopicMessagesByCursor: MessageConversationQueries['queryTopicMessagesByCursor'];

  queryAll: MessageAnalyticsQueries['queryAll'];
  count: MessageAnalyticsQueries['count'];
  countApproximate: MessageAnalyticsQueries['countApproximate'];
  countGroupByTopic: MessageAnalyticsQueries['countGroupByTopic'];
  topicMessageStats: MessageAnalyticsQueries['topicMessageStats'];
  hasTopicMessages: MessageAnalyticsQueries['hasTopicMessages'];
  findFirstAssistantInTopic: MessageAnalyticsQueries['findFirstAssistantInTopic'];
  countWords: MessageAnalyticsQueries['countWords'];
  rankModels: MessageAnalyticsQueries['rankModels'];
  getHeatmaps: MessageAnalyticsQueries['getHeatmaps'];
  getTokenHeatmaps: MessageAnalyticsQueries['getTokenHeatmaps'];
  hasMoreThanN: MessageAnalyticsQueries['hasMoreThanN'];
  countUpTo: MessageAnalyticsQueries['countUpTo'];

  create: MessageWriteMutations['create'];
  createUserAndAssistantMessages: MessageWriteMutations['createUserAndAssistantMessages'];
  batchCreate: MessageWriteMutations['batchCreate'];
  createMessageQuery: MessageWriteMutations['createMessageQuery'];
  update: MessageWriteMutations['update'];
  updateMetadata: MessageWriteMutations['updateMetadata'];

  updatePluginState: MessagePluginStore['updatePluginState'];
  updateMessagePlugin: MessagePluginStore['updateMessagePlugin'];
  resolveHumanApproval: MessageApprovalRepo['resolve'];
  restoreHumanApproval: MessageApprovalRepo['restore'];
  findMessagePlugin: MessagePluginStore['findMessagePlugin'];
  listMessagePluginsByTopic: MessagePluginStore['listMessagePluginsByTopic'];
  findLatestPluginStateInTopic: MessagePluginStore['findLatestPluginStateInTopic'];
  listToolCallsInTopics: MessagePluginStore['listToolCallsInTopics'];
  listMessagePluginsForOperation: MessagePluginStore['listMessagePluginsForOperation'];
  listMessagePluginsByIds: MessagePluginStore['listMessagePluginsByIds'];
  findToolMessageIdByToolCallId: MessagePluginStore['findToolMessageIdByToolCallId'];

  updateToolMessage: MessageToolMutations['updateToolMessage'];
  updateToolArguments: MessageToolMutations['updateToolArguments'];

  getLastMainThreadSpineMessageId: MessageSpineQueries['getLastMainThreadSpineMessageId'];
  isMessageDescendantOf: MessageSpineQueries['isMessageDescendantOf'];
  getLatestSpineMessageId: MessageSpineQueries['getLatestSpineMessageId'];
  getLatestNonToolMessageId: MessageSpineQueries['getLatestNonToolMessageId'];

  updateTranslate: MessageAnnotationMutations['updateTranslate'];
  updateTTS: MessageAnnotationMutations['updateTTS'];
  addFiles: MessageAnnotationMutations['addFiles'];
  deleteMessageTranslate: MessageAnnotationMutations['deleteMessageTranslate'];
  deleteMessageTTS: MessageAnnotationMutations['deleteMessageTTS'];
  deleteMessageQuery: MessageAnnotationMutations['deleteMessageQuery'];

  deleteMessage: MessageDeleteMutations['deleteMessage'];
  deleteMessages: MessageDeleteMutations['deleteMessages'];
  deleteMessagesBySession: MessageDeleteMutations['deleteMessagesBySession'];
  deleteAllMessages: MessageDeleteMutations['deleteAllMessages'];
  batchDeleteByAgentId: MessageDeleteMutations['batchDeleteByAgentId'];

  softDeleteMessages: MessageTrashMutations['softDeleteMessages'];
  restoreMessages: MessageTrashMutations['restoreMessages'];
  findTrashedByIds: MessageTrashMutations['findTrashedByIds'];
  softDeleteTopicless: MessageTrashMutations['softDeleteTopicless'];
  purgeMessages: MessageTrashMutations['purgeMessages'];

  listBackgroundSubAgentCalls: MessageBackgroundSubAgentQueries['listBackgroundSubAgentCalls'];
  claimBackgroundSubAgentDelivery: MessageBackgroundSubAgentQueries['claimBackgroundSubAgentDelivery'];
  releaseBackgroundSubAgentDelivery: MessageBackgroundSubAgentQueries['releaseBackgroundSubAgentDelivery'];

  private readonly annotations: MessageAnnotationMutations;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    ftsSearchCandidateSource?: FtsSearchCandidateSource,
    options: MessageModelOptions = {},
  ) {
    const args: MessageScopeArgs = [db, userId, workspaceId, ftsSearchCandidateSource, options];

    const lookups = new MessageLookupQueries(...args);
    const keywordSearch = new MessageKeywordSearchQueries(args, { lookups });
    const relations = new MessageRelationQueries(...args);
    const byIds = new MessageByIdsQueries(args, { relations });
    const page = new MessagePageQueries(args, { relations, byIds });
    const conversation = new MessageConversationQueries(args, { lookups, page });
    const analytics = new MessageAnalyticsQueries(...args);
    const writes = new MessageWriteMutations(...args);
    const plugins = new MessagePluginStore(args, { lookups });
    const tools = new MessageToolMutations(...args);
    const backgroundSubAgents = new MessageBackgroundSubAgentQueries(...args);
    const spine = new MessageSpineQueries(...args);
    const annotations = new MessageAnnotationMutations(args, { lookups });
    const snapshots = new MessageBranchSnapshots(...args);
    const deletion = new MessageDeleteMutations(args, { snapshots });
    const trash = new MessageTrashMutations(args, { snapshots });

    this.annotations = annotations;

    this.findById = lookups.findById;
    this.findShareVisitorMessageIds = lookups.findShareVisitorMessageIds;
    this.findByClientId = lookups.findByClientId;
    this.findLatestAssistantMessageByThread = lookups.findLatestAssistantMessageByThread;
    this.findVerifyMessageByOperationId = lookups.findVerifyMessageByOperationId;
    this.findLatestAssistantByOperationId = lookups.findLatestAssistantByOperationId;
    this.listLatestTurnAssistantContents = lookups.listLatestTurnAssistantContents;
    this.getThreadParentMessages = lookups.getThreadParentMessages;
    this.findMessageQueriesById = lookups.findMessageQueriesById;
    this.queryBySessionId = lookups.queryBySessionId;
    this.queryByKeyword = lookups.queryByKeyword;
    this.searchInTopic = lookups.searchInTopic;
    this.searchByKeyword = keywordSearch.searchByKeyword;
    this.queryByIds = byIds.queryByIds;
    this.queryWithWhere = page.queryWithWhere;
    this.queryLastUserMessageByTopics = conversation.queryLastUserMessageByTopics;
    this.query = conversation.query;
    this.queryForVisitor = conversation.queryForVisitor;
    this.countByTopic = conversation.countByTopic;
    this.queryTopicTranscript = conversation.queryTopicTranscript;
    this.queryTopicMessageTree = conversation.queryTopicMessageTree;
    this.queryTopicMessagesByCursor = conversation.queryTopicMessagesByCursor;
    this.queryAll = analytics.queryAll;
    this.count = analytics.count;
    this.countApproximate = analytics.countApproximate;
    this.countGroupByTopic = analytics.countGroupByTopic;
    this.topicMessageStats = analytics.topicMessageStats;
    this.hasTopicMessages = analytics.hasTopicMessages;
    this.findFirstAssistantInTopic = analytics.findFirstAssistantInTopic;
    this.countWords = analytics.countWords;
    this.rankModels = analytics.rankModels;
    this.getHeatmaps = analytics.getHeatmaps;
    this.getTokenHeatmaps = analytics.getTokenHeatmaps;
    this.hasMoreThanN = analytics.hasMoreThanN;
    this.countUpTo = analytics.countUpTo;
    this.create = writes.create;
    this.createUserAndAssistantMessages = writes.createUserAndAssistantMessages;
    this.batchCreate = writes.batchCreate;
    this.createMessageQuery = writes.createMessageQuery;
    this.update = writes.update;
    this.updateMetadata = writes.updateMetadata;
    this.updatePluginState = plugins.updatePluginState;
    this.updateMessagePlugin = plugins.updateMessagePlugin;
    // The approval claim locks and writes message roots and plugin rows in one
    // transaction; that unit of work is owned by the repository.
    const approvals = new MessageApprovalRepo(db, userId, workspaceId, options);
    this.resolveHumanApproval = approvals.resolve;
    this.restoreHumanApproval = approvals.restore;
    this.findMessagePlugin = plugins.findMessagePlugin;
    this.listMessagePluginsByTopic = plugins.listMessagePluginsByTopic;
    this.findLatestPluginStateInTopic = plugins.findLatestPluginStateInTopic;
    this.listToolCallsInTopics = plugins.listToolCallsInTopics;
    this.listMessagePluginsForOperation = plugins.listMessagePluginsForOperation;
    this.listMessagePluginsByIds = plugins.listMessagePluginsByIds;
    this.findToolMessageIdByToolCallId = plugins.findToolMessageIdByToolCallId;
    this.updateToolMessage = tools.updateToolMessage;
    this.updateToolArguments = tools.updateToolArguments;
    this.listBackgroundSubAgentCalls = backgroundSubAgents.listBackgroundSubAgentCalls;
    this.claimBackgroundSubAgentDelivery = backgroundSubAgents.claimBackgroundSubAgentDelivery;
    this.releaseBackgroundSubAgentDelivery = backgroundSubAgents.releaseBackgroundSubAgentDelivery;
    this.getLastMainThreadSpineMessageId = spine.getLastMainThreadSpineMessageId;
    this.isMessageDescendantOf = spine.isMessageDescendantOf;
    this.getLatestSpineMessageId = spine.getLatestSpineMessageId;
    this.getLatestNonToolMessageId = spine.getLatestNonToolMessageId;
    this.updateTranslate = annotations.updateTranslate;
    this.updateTTS = annotations.updateTTS;
    this.addFiles = annotations.addFiles;
    this.deleteMessageTranslate = annotations.deleteMessageTranslate;
    this.deleteMessageTTS = annotations.deleteMessageTTS;
    this.deleteMessageQuery = annotations.deleteMessageQuery;
    this.deleteMessage = deletion.deleteMessage;
    this.deleteMessages = deletion.deleteMessages;
    this.deleteMessagesBySession = deletion.deleteMessagesBySession;
    this.deleteAllMessages = deletion.deleteAllMessages;
    this.batchDeleteByAgentId = deletion.batchDeleteByAgentId;
    this.softDeleteMessages = trash.softDeleteMessages;
    this.restoreMessages = trash.restoreMessages;
    this.findTrashedByIds = trash.findTrashedByIds;
    this.softDeleteTopicless = trash.softDeleteTopicless;
    this.purgeMessages = trash.purgeMessages;
  }

  async updateMessageRAG(id: string, params: UpdateMessageRAGParams) {
    return this.annotations.updateMessageRAG(id, params);
  }

  /**
   * Check which user IDs from the given list have at least one message.
   */
  static checkUsersHaveMessages = async (
    db: LobeChatDatabase,
    userIds: string[],
  ): Promise<Set<string>> => {
    if (userIds.length === 0) return new Set();
    const result = await db
      .select({ userId: messages.userId })
      .from(messages)
      .where(inArray(messages.userId, userIds))
      .groupBy(messages.userId);
    return new Set(result.map((r) => r.userId));
  };
}

export { HumanApprovalAlreadyResolvedError } from './plugin';
export type {
  MessageKeywordSearchItem,
  MessageKeywordSearchParams,
  MessageKeywordSearchResult,
} from './search';
export { MESSAGE_KEYWORD_SEARCH_MAX_LIMIT } from './search';
export * from './types';
export { redactCreatorPrivateBlob, sanitizeVisitorError, toVisitorMessage } from './visitor';
