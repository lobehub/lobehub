/**
 * Lobe Page Agent Executor
 *
 * Creates and exports the PageAgentExecutor instance for registration.
 * Also exports the runtime for editor instance injection.
 */
import { PageAgentExecutionRuntime } from '@lobechat/builtin-tool-page-agent/executionRuntime';
import { PageAgentExecutor } from '@lobechat/builtin-tool-page-agent/executor';

// Create singleton instance of the runtime
export const pageAgentRuntime = new PageAgentExecutionRuntime();

// Create executor instance with the runtime
export const pageAgentExecutor = new PageAgentExecutor(pageAgentRuntime);
