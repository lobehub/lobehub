/** Editable resource families that can broadcast realtime events. */
export type ResourceType = 'agent' | 'chatGroup' | 'document' | 'task';

export interface ResourceRef {
  id: string;
  type: ResourceType;
}

export type ResourceEventType = 'doc.updated' | 'lock.changed';

export interface ResourceEvent {
  /** User id that triggered the event; lets subscribers ignore self-originated events. */
  actorId: string;
  /** Event-specific payload (e.g. `{ holderId }` for `lock.changed`). */
  data?: Record<string, unknown>;
  type: ResourceEventType;
}

export interface ReceivedResourceEvent extends ResourceEvent {
  timestamp: number;
}
