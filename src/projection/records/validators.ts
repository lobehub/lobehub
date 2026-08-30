import type { ProjectionRecord } from '@lobechat/types';
import { isProjectionFragmentName, isProjectionKind, isProjectionTimestamp } from '@lobechat/types';

import { isObject, isProjectionFragment } from '../core/validation';

export const isProjectionRecord = (value: unknown): value is ProjectionRecord => {
  if (
    !isObject(value) ||
    typeof value.id !== 'string' ||
    !isProjectionKind(value.kind) ||
    !isObject(value.fragments) ||
    (value.tombstoneAt !== undefined && !isProjectionTimestamp(value.tombstoneAt))
  ) {
    return false;
  }

  const kind = value.kind;
  return Object.entries(value.fragments).every(
    ([name, fragment]) => isProjectionFragmentName(kind, name) && isProjectionFragment(fragment),
  );
};
