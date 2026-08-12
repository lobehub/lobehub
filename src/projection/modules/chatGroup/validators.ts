import type { ChatGroupListIndex } from '@lobechat/types';
import { chatGroupIndexKeySpace } from '@lobechat/types';

import { hasObservation, isObject, isProjectionRef } from '../../core/validation';

export const isChatGroupIndex = (value: unknown): value is ChatGroupListIndex =>
  isObject(value) &&
  chatGroupIndexKeySpace.isKey(value.key) &&
  hasObservation(value) &&
  Array.isArray(value.refs) &&
  value.refs.every((ref) => isProjectionRef(ref, 'chatGroup'));
