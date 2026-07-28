/** Resource families that can broadcast realtime invalidation or collaboration events. */
export type ResourceType = 'agent' | 'chatGroup' | 'document' | 'task' | 'topic';

export interface ResourceRef {
  id: string;
  type: ResourceType;
}

export type ResourceEventType = 'doc.updated' | 'lock.changed' | 'topic.commentsChanged';

export interface ResourceEvent {
  /** User id that triggered the event; allows subscriber-side attribution or filtering. */
  actorId: string;
  /** Event-specific payload (e.g. `{ holderId }` for `lock.changed`). */
  data?: Record<string, unknown>;
  type: ResourceEventType;
}

export interface ReceivedResourceEvent extends ResourceEvent {
  timestamp: number;
}
