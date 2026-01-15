import { type BuiltinStreaming } from '@lobechat/types';

import { MemoryApiName } from '../../types';
import { AddExperienceMemoryStreaming } from './AddExperienceMemory';

/**
 * Memory Streaming Components Registry
 *
 * Streaming components are used to render tool calls while arguments
 * are still being generated, allowing real-time feedback to users.
 */
export const MemoryStreamings: Record<string, BuiltinStreaming> = {
  [MemoryApiName.addExperienceMemory]: AddExperienceMemoryStreaming as BuiltinStreaming,
};



export {AddExperienceMemoryStreaming} from './AddExperienceMemory';