/**
 * Lobe Page Agent Executor
 *
 * Creates and exports the PageAgentExecutor instance for registration.
 * Also exports the runtime for editor instance injection.
 */
import { PageAgentExecutor } from '@lobechat/builtin-tool-page-agent/executor';
import { EditorRuntime } from '@lobechat/editor-runtime';

// Create singleton instance of the runtime
export const pageAgentRuntime = new EditorRuntime();

// Create executor instance with the runtime
export const pageAgentExecutor = new PageAgentExecutor(pageAgentRuntime);
