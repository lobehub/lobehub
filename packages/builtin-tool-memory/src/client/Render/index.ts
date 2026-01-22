import type { BuiltinRender } from '@lobechat/types';

import { MemoryApiName } from '../../types';
import AddExperienceMemoryRender from './AddExperienceMemory';
import AddPreferenceMemoryRender from './AddPreferenceMemory';
import SearchUserMemoryRender from './SearchUserMemory';

/**
 * Memory Render Components Registry
 *
 * Render components display the final result of tool execution.
 */
export const MemoryRenders: Record<string, BuiltinRender> = {
  [MemoryApiName.addExperienceMemory]: AddExperienceMemoryRender as BuiltinRender,
  [MemoryApiName.addPreferenceMemory]: AddPreferenceMemoryRender as BuiltinRender,
  [MemoryApiName.searchUserMemory]: SearchUserMemoryRender as BuiltinRender,
};
