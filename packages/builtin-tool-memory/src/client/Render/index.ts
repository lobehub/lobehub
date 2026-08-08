import type { BuiltinRender } from '@lobechat/types';

import { MemoryApiName } from '../../types';
import AddActivityMemoryRender from './AddActivityMemory';
import AddContextMemoryRender from './AddContextMemory';
import AddExperienceMemoryRender from './AddExperienceMemory';
import AddIdentityMemoryRender from './AddIdentityMemory';
import AddPreferenceMemoryRender from './AddPreferenceMemory';
import RemoveIdentityMemoryRender from './RemoveIdentityMemory';
import SearchUserMemoryRender from './SearchUserMemory';
import UpdateIdentityMemoryRender from './UpdateIdentityMemory';

/**
 * Memory Render Components Registry
 *
 * Render components display the final result of tool execution.
 */
export const MemoryRenders: Record<string, BuiltinRender> = {
  [MemoryApiName.addActivityMemory]: AddActivityMemoryRender as BuiltinRender,
  [MemoryApiName.addContextMemory]: AddContextMemoryRender as BuiltinRender,
  [MemoryApiName.addExperienceMemory]: AddExperienceMemoryRender as BuiltinRender,
  [MemoryApiName.addIdentityMemory]: AddIdentityMemoryRender as BuiltinRender,
  [MemoryApiName.addPreferenceMemory]: AddPreferenceMemoryRender as BuiltinRender,
  [MemoryApiName.removeIdentityMemory]: RemoveIdentityMemoryRender as BuiltinRender,
  [MemoryApiName.searchUserMemory]: SearchUserMemoryRender as BuiltinRender,
  [MemoryApiName.updateIdentityMemory]: UpdateIdentityMemoryRender as BuiltinRender,
};
