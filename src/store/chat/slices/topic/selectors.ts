import type { ChatStoreState } from '../../initialState';
import { operationSelectors } from '../operation/selectors';

const isCreatingTopic = (state: ChatStoreState) => state.creatingTopic;
const isInSearchMode = (state: ChatStoreState) => state.inSearchingMode;
const isNewTopicSendInFlight = (state: ChatStoreState): boolean =>
  !state.activeTopicId &&
  operationSelectors.isInputLoadingByContext({
    agentId: state.activeAgentId,
    groupId: state.activeGroupId,
    threadId: state.activeThreadId,
    topicId: state.activeTopicId,
  })(state);

/** ChatStore owns only Topic interaction state; entity selectors live in Projection. */
export const topicSelectors = {
  isCreatingTopic,
  isInSearchMode,
  isNewTopicSendInFlight,
};
