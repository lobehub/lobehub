import { agentIndexKeySpace } from './modules/agent';
import { briefIndexKeySpace } from './modules/brief';
import { chatIndexKeySpace } from './modules/chat';
import { chatGroupIndexKeySpace } from './modules/chatGroup';
import { homeIndexKeySpace, homeSnapshotKeySpace } from './modules/home';
import { taskIndexKeySpace } from './modules/task';
import { AGENT_PROJECTION_FRAGMENT_NAMES } from './records/agent';
import { BRIEF_PROJECTION_FRAGMENT_NAMES } from './records/brief';
import { CHAT_GROUP_PROJECTION_FRAGMENT_NAMES } from './records/chatGroup';
import type { ProjectionFragmentName, ProjectionKind } from './records/index';
import { TASK_PROJECTION_FRAGMENT_NAMES } from './records/task';
import { TOPIC_PROJECTION_FRAGMENT_NAMES } from './records/topic';
import { defineProjectionKeySpace } from './runtime';

export const projectionIndexKeySpace = defineProjectionKeySpace({
  patterns: [
    ...agentIndexKeySpace.patterns,
    ...briefIndexKeySpace.patterns,
    ...chatIndexKeySpace.patterns,
    ...chatGroupIndexKeySpace.patterns,
    ...homeIndexKeySpace.patterns,
    ...taskIndexKeySpace.patterns,
  ],
  staticKeys: [
    ...agentIndexKeySpace.staticKeys,
    ...briefIndexKeySpace.staticKeys,
    ...chatIndexKeySpace.staticKeys,
    ...chatGroupIndexKeySpace.staticKeys,
    ...homeIndexKeySpace.staticKeys,
    ...taskIndexKeySpace.staticKeys,
  ],
});

export const projectionSnapshotKeySpace = defineProjectionKeySpace({
  patterns: [...homeSnapshotKeySpace.patterns],
  staticKeys: [...homeSnapshotKeySpace.staticKeys],
});

export const PROJECTION_FRAGMENT_NAMES = {
  agent: AGENT_PROJECTION_FRAGMENT_NAMES,
  brief: BRIEF_PROJECTION_FRAGMENT_NAMES,
  chatGroup: CHAT_GROUP_PROJECTION_FRAGMENT_NAMES,
  task: TASK_PROJECTION_FRAGMENT_NAMES,
  topic: TOPIC_PROJECTION_FRAGMENT_NAMES,
} as const satisfies { [K in ProjectionKind]: readonly ProjectionFragmentName<K>[] };

export const PROJECTION_KINDS = Object.keys(PROJECTION_FRAGMENT_NAMES) as ProjectionKind[];

export const isProjectionIndexKey = projectionIndexKeySpace.isKey;
export const isProjectionSnapshotKey = projectionSnapshotKeySpace.isKey;

export const isProjectionKind = (value: unknown): value is ProjectionKind =>
  typeof value === 'string' && Object.hasOwn(PROJECTION_FRAGMENT_NAMES, value);

export const isProjectionFragmentName = <Kind extends ProjectionKind>(
  kind: Kind,
  value: unknown,
): value is ProjectionFragmentName<Kind> =>
  typeof value === 'string' &&
  (PROJECTION_FRAGMENT_NAMES[kind] as readonly string[]).includes(value);
