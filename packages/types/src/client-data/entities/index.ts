import type { EntityRecord } from '../../entity';
import type { AgentEntityFragments } from './agent';
import type { BriefEntityFragments } from './brief';
import type { ChatGroupEntityFragments } from './chatGroup';
import type { TaskEntityFragments } from './task';
import type { TopicEntityFragments } from './topic';

export * from './agent';
export * from './brief';
export * from './chatGroup';
export * from './shared';
export * from './task';
export * from './topic';

export type AgentEntityRecord = EntityRecord<'agent', AgentEntityFragments>;
export type ChatGroupEntityRecord = EntityRecord<'chatGroup', ChatGroupEntityFragments>;
export type TopicEntityRecord = EntityRecord<'topic', TopicEntityFragments>;
export type TaskEntityRecord = EntityRecord<'task', TaskEntityFragments>;
export type BriefEntityRecord = EntityRecord<'brief', BriefEntityFragments>;

export type ClientDataEntityKind = 'agent' | 'brief' | 'chatGroup' | 'task' | 'topic';
export type ClientDataEntityRecord =
  | AgentEntityRecord
  | BriefEntityRecord
  | ChatGroupEntityRecord
  | TaskEntityRecord
  | TopicEntityRecord;
