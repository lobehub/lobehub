import type { BuiltinStreaming } from '@lobechat/types';

import { DocumentApiName } from '../../types';
import { InitPageStreaming } from './InitPage';

/**
 * Page Agent Streaming Components Registry
 *
 * Streaming components are used to render tool calls while arguments
 * are still being generated, allowing real-time feedback to users.
 */
export const PageAgentStreamings: Record<string, BuiltinStreaming> = {
  [DocumentApiName.initPage]: InitPageStreaming as BuiltinStreaming,
};
