import type { ResourcePermissionState } from './initialState';
import { resourceKey, type ResourceRef } from './projection';

/** `accessSessionMap` key: the same resource is a separate answer per identity scope. */
export const accessSessionKey = (scope: string, key: string): string => `${scope}|${key}`;

const access = (ref: ResourceRef | null) => (s: ResourcePermissionState) =>
  ref ? s.accessMap[resourceKey(ref)] : undefined;

/** What the server answered for this record during this session, if anything. */
const sessionCheck = (ref: ResourceRef | null, scope: string) => (s: ResourcePermissionState) =>
  ref ? s.accessSessionMap[accessSessionKey(scope, resourceKey(ref))] : undefined;

const collaborators = (ref: ResourceRef | null) => (s: ResourcePermissionState) =>
  ref ? s.collaboratorsMap[resourceKey(ref)] : undefined;

export const resourcePermissionSelectors = {
  access,
  collaborators,
  sessionCheck,
};
