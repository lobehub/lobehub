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

export interface ProjectionFragmentMap {
  agent: AgentProjectionFragments;
  brief: BriefProjectionFragments;
  chatGroup: ChatGroupProjectionFragments;
  task: TaskProjectionFragments;
  topic: TopicProjectionFragments;
}
export type ProjectionKind = keyof ProjectionFragmentMap;
export type ProjectionFragmentName<K extends ProjectionKind> = Extract<
  keyof ProjectionFragmentMap[K],
  string
>;
export type ProjectionRecordMap = {
  [K in ProjectionKind]: ProjectionRecordBase<K, ProjectionFragmentMap[K]>;
};

export type AgentProjection = ProjectionRecordMap['agent'];
export type BriefProjection = ProjectionRecordMap['brief'];
export type ChatGroupProjection = ProjectionRecordMap['chatGroup'];
export type TaskProjection = ProjectionRecordMap['task'];
export type TopicProjection = ProjectionRecordMap['topic'];
export type ProjectionRecord = ProjectionRecordMap[ProjectionKind];
