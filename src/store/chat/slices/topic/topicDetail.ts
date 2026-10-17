import isEqual from 'fast-deep-equal';

import { createReplicaSlice, recordLens, singleEntity } from '@/libs/replica';
import { topicService } from '@/services/topic';
import type { ChatStore } from '@/store/chat';
import type { StoreSetter } from '@/store/types';
import type { ChatTopic } from '@/types/topic';
import { setNamespace } from '@/utils/storeDebug';

import { INPUT_LOADING_OPERATION_TYPES } from '../operation/types';
import { topicDetailResource } from './projection';
import { topicSelectors } from './selectors';

const topicOperations = (state: ChatStore, topicId: string) =>
  Object.values(state.operations).filter(
    (op) => op.context.topicId === topicId && INPUT_LOADING_OPERATION_TYPES.includes(op.type),
  );

/** Include terminal bookkeeping: its stream still owns the conversation. */
export const hasLocalTopicRun = (state: ChatStore, topicId: string) =>
  topicOperations(state, topicId).some((op) => op.status === 'running');

/** Topic details also discover runs started by SCM, schedules, or another client. */
export const createTopicDetailSlice = ({
  get,
  set,
  onRunningOperation,
}: {
  get: () => ChatStore;
  onRunningOperation: (topic: ChatTopic) => void;
  set: StoreSetter<ChatStore>;
}) => {
  const snapshots = new WeakMap<ChatTopic, { operationIds: string; topic?: ChatTopic }>();
  const operationIds = (topicId: string) =>
    topicOperations(get(), topicId)
      .map((op) => op.id)
      .join(',');

  return createReplicaSlice(topicDetailResource, {
    actionPrefix: setNamespace('t')('topicDetail'),
    effects: {
      onApplied: (topic) => {
        if (topic?.metadata?.runningOperation && !hasLocalTopicRun(get(), topic.id)) {
          onRunningOperation(topic);
        }
      },
    },
    entity: singleEntity<ChatTopic>((topic) => topic.id),
    fetcher: async (topicId) => {
      const snapshot = {
        operationIds: operationIds(topicId),
        topic: topicSelectors.getTopicById(topicId)(get()),
      };
      const topic = await topicService.getTopicDetail(topicId);
      if (topic) snapshots.set(topic, snapshot);
      return topic;
    },
    get,
    // Keep cached details when a topic is missing, as before.
    merge: (topic, confirmed) => (!topic || isEqual(topic, confirmed) ? undefined : topic),
    prepareHead: (topic, _current, topicId) => {
      const snapshot = topic && snapshots.get(topic);
      // A local send, stop, or topic edit may overtake this read. Do not install
      // an older marker over it, even if that local run has already finished.
      if (
        snapshot &&
        (snapshot.topic !== topicSelectors.getTopicById(topicId)(get()) ||
          snapshot.operationIds !== operationIds(topicId))
      )
        return undefined;
      return topic;
    },
    set,
    stateKey: 'topicDetailReplica',
    view: recordLens<ChatStore, ChatTopic>('topicDetailMap'),
  });
};
