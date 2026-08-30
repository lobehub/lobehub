import type { BriefNewsIndex } from '@lobechat/types';
import { briefIndexKeySpace } from '@lobechat/types';

import { hasObservation, isObject, isProjectionRef } from '../../core/validation';

export const isBriefIndex = (value: unknown): value is BriefNewsIndex =>
  isObject(value) &&
  briefIndexKeySpace.isKey(value.key) &&
  typeof value.day === 'string' &&
  typeof value.hasEarlier === 'boolean' &&
  hasObservation(value) &&
  Array.isArray(value.refs) &&
  value.refs.every((ref) => isProjectionRef(ref, 'brief'));
