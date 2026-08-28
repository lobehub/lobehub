/**
 * Lobe Page Agent Executor
 *
 * Creates and exports the PageAgentExecutor instance for lazy registration.
 */
import { PageAgentExecutor } from '@lobechat/builtin-tool-page-agent/client/executor';

import { pageAgentRuntime } from './pageAgentRuntime';

// Create executor instance with the runtime
export const pageAgentExecutor = new PageAgentExecutor(pageAgentRuntime);
