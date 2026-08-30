import type { AgentAvailableIndex, AgentDirectoryIndex, AgentSearchIndex } from '@lobechat/types';
import { AGENT_INDEX_KEYS, agentIndexKeySpace } from '@lobechat/types';

import { hasObservation, isObject, isProjectionRef } from '../../core/validation';

export const isAgentIndex = (
  value: unknown,
): value is AgentAvailableIndex | AgentDirectoryIndex | AgentSearchIndex => {
  if (!isObject(value) || !hasObservation(value) || typeof value.key !== 'string') return false;
  if (!agentIndexKeySpace.isKey(value.key)) return false;
  if (!Array.isArray(value.refs)) {
    return false;
  }
  const validRefs =
    value.key === AGENT_INDEX_KEYS.available || value.key === AGENT_INDEX_KEYS.directory
      ? value.refs.every((ref) => isProjectionRef(ref, 'agent'))
      : value.refs.every(
          (ref) =>
            isObject(ref) &&
            (isProjectionRef(ref, 'agent') || isProjectionRef(ref, 'chatGroup')) &&
            typeof ref.pinned === 'boolean' &&
            ref.updatedAt instanceof Date &&
            Number.isFinite(ref.updatedAt.getTime()),
        );
  if (!validRefs) return false;
  if (!isObject(value.signature)) return false;
  return (
    (value.signature.keyword === undefined || typeof value.signature.keyword === 'string') &&
    (value.signature.limit === undefined || Number.isInteger(value.signature.limit)) &&
    (value.signature.offset === undefined || Number.isInteger(value.signature.offset))
  );
};
