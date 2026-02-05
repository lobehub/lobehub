import type { BuiltinInspector } from '@lobechat/types';

import { MemoryApiName } from '../../types';
import { AddContextMemoryInspector } from './AddContextMemory';
import { AddExperienceMemoryInspector } from './AddExperienceMemory';
import { AddIdentityMemoryInspector } from './AddIdentityMemory';
import { AddPreferenceMemoryInspector } from './AddPreferenceMemory';
import { RemoveIdentityMemoryInspector } from './RemoveIdentityMemory';
import { SearchUserMemoryInspector } from './SearchUserMemory';
import { UpdateIdentityMemoryInspector } from './UpdateIdentityMemory';

/**
 * Memory Inspector Components Registry
 *
 * Inspector components customize the title/header area
 * of tool calls in the conversation UI.
 */
export const MemoryInspectors: Record<string, BuiltinInspector> = {
  [MemoryApiName.addContextMemory]: AddContextMemoryInspector as BuiltinInspector,
  [MemoryApiName.addExperienceMemory]: AddExperienceMemoryInspector as BuiltinInspector,
  [MemoryApiName.addIdentityMemory]: AddIdentityMemoryInspector as BuiltinInspector,
  [MemoryApiName.addPreferenceMemory]: AddPreferenceMemoryInspector as BuiltinInspector,
  [MemoryApiName.removeIdentityMemory]: RemoveIdentityMemoryInspector as BuiltinInspector,
  [MemoryApiName.searchUserMemory]: SearchUserMemoryInspector as BuiltinInspector,
  [MemoryApiName.updateIdentityMemory]: UpdateIdentityMemoryInspector as BuiltinInspector,
};

// Re-export individual inspectors
export { AddContextMemoryInspector } from './AddContextMemory';
export { AddExperienceMemoryInspector } from './AddExperienceMemory';
export { AddIdentityMemoryInspector } from './AddIdentityMemory';
export { AddPreferenceMemoryInspector } from './AddPreferenceMemory';
export { RemoveIdentityMemoryInspector } from './RemoveIdentityMemory';
export { SearchUserMemoryInspector } from './SearchUserMemory';
export { UpdateIdentityMemoryInspector } from './UpdateIdentityMemory';
