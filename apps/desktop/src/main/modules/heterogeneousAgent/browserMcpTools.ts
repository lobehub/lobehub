import type { McpExtraTool, McpToolResult } from '@lobechat/heterogeneous-agents/builtinMcp';
import { z } from 'zod';

/**
 * Proxies one in-app browser api call for a heterogeneous operation. The
 * controller resolves the op → agent binding and forwards to
 * `BrowserControlCtr.runGatewayToolCall` (same funnel as cloud-gateway calls).
 */
export type BrowserMcpToolHandler = (
  operationId: string,
  apiName: string,
  args: Record<string, unknown>,
) => Promise<McpToolResult>;

interface BrowserMcpToolSpec {
  /** `BrowserManifest.api` name the handler forwards to. */
  apiName: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** MCP-facing tool name (CC sees `mcp__lobe_cc__<name>`). */
  name: string;
  title: string;
}

/**
 * Mirrors `BrowserManifest.api` from `@lobechat/builtin-tool-browser` — the
 * desktop main deliberately doesn't depend on that renderer-side package
 * (same convention as GatewayConnectionCtr's `BrowserIdentifier` mirror), so
 * the schemas are restated here as zod shapes for the MCP SDK.
 */
export const BROWSER_MCP_TOOLS: BrowserMcpToolSpec[] = [
  {
    apiName: 'navigate',
    description:
      'Open a URL in the in-app browser sidebar, visible to the user in real time. Opens the panel automatically if it is closed.',
    inputSchema: { url: z.string().describe('Absolute URL to open (http/https).') },
    name: 'browser_navigate',
    title: 'Open URL in in-app browser',
  },
  {
    apiName: 'snapshot',
    description:
      'Capture an accessibility snapshot of the current in-app browser page: interactive elements (links, buttons, inputs, headings) with stable refs like [ref=e12] for use in click/fill. Always snapshot before acting, and re-snapshot after the page changes.',
    inputSchema: {},
    name: 'browser_snapshot',
    title: 'Snapshot in-app browser page',
  },
  {
    apiName: 'click',
    description:
      'Click an element in the in-app browser. Prefer a ref from the latest snapshot; viewport x/y coordinates are a fallback for canvas-like surfaces.',
    inputSchema: {
      ref: z.string().optional().describe('Element ref from the latest snapshot, e.g. "e12".'),
      x: z.number().optional().describe('Viewport x coordinate (only when no ref is available).'),
      y: z.number().optional().describe('Viewport y coordinate (only when no ref is available).'),
    },
    name: 'browser_click',
    title: 'Click element in in-app browser',
  },
  {
    apiName: 'fill',
    description:
      'Fill a text input, textarea, or contenteditable in the in-app browser identified by a snapshot ref. Set submit=true to press Enter afterwards.',
    inputSchema: {
      ref: z.string().describe('Element ref from the latest snapshot.'),
      submit: z
        .boolean()
        .optional()
        .describe('Press Enter after filling (submit search/login forms).'),
      text: z.string().describe('Text to fill.'),
    },
    name: 'browser_fill',
    title: 'Fill input in in-app browser',
  },
  {
    apiName: 'press',
    description:
      'Send a keyboard key to the in-app browser page, e.g. Enter, Tab, Escape, ArrowDown.',
    inputSchema: {
      key: z.string().describe('KeyboardEvent.key value (Enter, Tab, Escape, ArrowDown, ...).'),
    },
    name: 'browser_press',
    title: 'Press key in in-app browser',
  },
  {
    apiName: 'scroll',
    description:
      'Scroll the in-app browser page vertically (positive dy scrolls down) or horizontally.',
    inputSchema: {
      dx: z.number().optional().describe('Horizontal pixels to scroll.'),
      dy: z.number().describe('Vertical pixels to scroll. Positive scrolls down.'),
    },
    name: 'browser_scroll',
    title: 'Scroll in-app browser page',
  },
  {
    apiName: 'screenshot',
    description:
      'Capture a screenshot of the current in-app browser page. The image is returned to you and also visible to the user.',
    inputSchema: {},
    name: 'browser_screenshot',
    title: 'Screenshot in-app browser page',
  },
  {
    apiName: 'readPage',
    description:
      'Extract the readable text content of the current in-app browser page (for quoting or summarizing).',
    inputSchema: {},
    name: 'browser_read_page',
    title: 'Read in-app browser page text',
  },
];

/**
 * Build the MCP tool registrations the desktop mounts on the per-process
 * `AskUserMcpServer` so Claude Code can drive the in-app browser sidebar.
 */
export const buildBrowserMcpTools = (handler: BrowserMcpToolHandler): McpExtraTool[] =>
  BROWSER_MCP_TOOLS.map((tool) => ({
    description: tool.description,
    handler: (operationId, args) => handler(operationId, tool.apiName, args),
    inputSchema: tool.inputSchema,
    name: tool.name,
    title: tool.title,
  }));
