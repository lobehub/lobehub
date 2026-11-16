import { MCP_EVENT_TAG } from '@/const/plugin';

import { createRemarkXmlBlockPlugin } from '../remarkPlugins/createRemarkXmlBlockPlugin';

/** Captures `<mcpEvent …>…</mcpEvent>` blocks; see {@link createRemarkXmlBlockPlugin}. */
export const remarkMcpEventBlock = createRemarkXmlBlockPlugin(MCP_EVENT_TAG);
