import type { BuiltinStreaming } from '@lobechat/types';

import { GTDApiName } from '../../types';
import { CreatePlanStreaming } from './CreatePlan';

/**
 * GTD Streaming Components Registry
 *
 * Streaming components render tool calls while they are
 * still executing, allowing real-time feedback to users.
 */
export const GTDStreamings: Record<string, BuiltinStreaming> = {
  [GTDApiName.createPlan]: CreatePlanStreaming as BuiltinStreaming,
};

export { CreatePlanStreaming } from './CreatePlan';
