import type { ProjectionRecordBase } from '../base';
import type { AgentProjectionFragments } from './agent';
import type { BriefProjectionFragments } from './brief';
import type { ChatGroupProjectionFragments } from './chatGroup';
import type { TaskProjectionFragments } from './task';
import type { TopicProjectionFragments } from './topic';

export * from './agent';
export * from './brief';
export * from './chatGroup';
export * from './shared';
export * from './task';
export * from './topic';

export type AgentProjection = ProjectionRecordBase<'agent', AgentProjectionFragments>;
export type ChatGroupProjection = ProjectionRecordBase<'chatGroup', ChatGroupProjectionFragments>;
export type TopicProjection = ProjectionRecordBase<'topic', TopicProjectionFragments>;
export type TaskProjection = ProjectionRecordBase<'task', TaskProjectionFragments>;
export type BriefProjection = ProjectionRecordBase<'brief', BriefProjectionFragments>;

export type ProjectionKind = 'agent' | 'brief' | 'chatGroup' | 'task' | 'topic';
export type ProjectionRecord =
  AgentProjection | BriefProjection | ChatGroupProjection | TaskProjection | TopicProjection;
