import type { BuiltinRestrictedManifestResolver } from '@lobechat/types';

import { MemoryManifest } from './manifest';
import { memoryReadOnlySystemPrompt } from './readOnlySystemRole';
import { MEMORY_READ_API_NAMES } from './types';

const memoryReadApiNames = new Set<string>(MEMORY_READ_API_NAMES);

const matchesExactApiSet = (apiNames: readonly string[], expected: ReadonlySet<string>) => {
  const actual = new Set(apiNames);

  return actual.size === expected.size && [...actual].every((apiName) => expected.has(apiName));
};

export const resolveMemoryRestrictedManifest: BuiltinRestrictedManifestResolver = ({
  allowedApiNames,
  restriction,
}) => {
  if (restriction !== 'agentShare' || !matchesExactApiSet(allowedApiNames, memoryReadApiNames)) {
    return undefined;
  }

  return {
    ...MemoryManifest,
    api: MemoryManifest.api.filter((api) => memoryReadApiNames.has(api.name)),
    systemRole: memoryReadOnlySystemPrompt,
  };
};
