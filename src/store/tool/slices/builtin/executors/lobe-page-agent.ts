/**
 * Lobe Page Agent Executor
 *
 * Creates and exports the PageAgentExecutor instance for registration.
 * Also exports the runtime for editor instance injection.
 */
import { PageAgentExecutor } from '@lobechat/builtin-tool-page-agent/client';
import { EditorRuntime } from '@lobechat/editor-runtime';
import { LITEXML_APPLY_COMMAND, LITEXML_MODIFY_COMMAND } from '@lobehub/editor';

// Create singleton instance of the runtime
export const pageAgentRuntime = new EditorRuntime();

// Renderer-side LiteXML dispatch: forward to the live editor's command bus.
// The server-side runtime registers its own adapter (HeadlessEditor-backed) at
// `src/server/services/toolExecution/serverRuntimes/pageAgent.ts`.
pageAgentRuntime.setLiteXMLAdapter({
  applyBatch: (editor, operations) => {
    editor.dispatchCommand(LITEXML_MODIFY_COMMAND, operations);
  },
  applyReplace: (editor, litexml) => {
    editor.dispatchCommand(LITEXML_APPLY_COMMAND, { litexml });
  },
});

// Create executor instance with the runtime
export const pageAgentExecutor = new PageAgentExecutor(pageAgentRuntime);
