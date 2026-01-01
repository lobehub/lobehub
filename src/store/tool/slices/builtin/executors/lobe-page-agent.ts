/**
 * Lobe Page Agent Executor
 *
 * Creates and exports the PageAgentExecutor instance for registration.
 * Also exports the runtime for editor instance injection.
 */
import { EditorRuntime } from '@lobechat/editor-runtime';
import { PageAgentExecutor } from '@lobechat/builtin-tool-page-agent/executor';

// Create singleton instance of the runtime
export const pageAgentRuntime = new EditorRuntime();

// Create executor instance with the runtime
export const pageAgentExecutor = new PageAgentExecutor(pageAgentRuntime);
