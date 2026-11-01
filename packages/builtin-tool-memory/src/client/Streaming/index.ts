import type { BuiltinStreaming } from '@lobechat/types';

import { MemoryApiName } from '../../types';
import { AddActivityMemoryStreaming } from './AddActivityMemory';
import { AddContextMemoryStreaming } from './AddContextMemory';
import { AddExperienceMemoryStreaming } from './AddExperienceMemory';
import { AddIdentityMemoryStreaming } from './AddIdentityMemory';
import { AddPreferenceMemoryStreaming } from './AddPreferenceMemory';

/**
 * Memory Streaming Components Registry
 *
 * Streaming components are used to render tool calls while arguments
 * are still being generated, allowing real-time feedback to users.
 */
export const MemoryStreamings: Record<string, BuiltinStreaming> = {
  [MemoryApiName.addActivityMemory]: AddActivityMemoryStreaming as BuiltinStreaming,
  [MemoryApiName.addContextMemory]: AddContextMemoryStreaming as BuiltinStreaming,
  [MemoryApiName.addExperienceMemory]: AddExperienceMemoryStreaming as BuiltinStreaming,
  [MemoryApiName.addIdentityMemory]: AddIdentityMemoryStreaming as BuiltinStreaming,
  [MemoryApiName.addPreferenceMemory]: AddPreferenceMemoryStreaming as BuiltinStreaming,
};

export { AddActivityMemoryStreaming } from './AddActivityMemory';
export { AddContextMemoryStreaming } from './AddContextMemory';
export { AddExperienceMemoryStreaming } from './AddExperienceMemory';
export { AddIdentityMemoryStreaming } from './AddIdentityMemory';
export { AddPreferenceMemoryStreaming } from './AddPreferenceMemory';
