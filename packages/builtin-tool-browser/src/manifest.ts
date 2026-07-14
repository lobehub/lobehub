import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { BrowserApiName, BrowserIdentifier } from './types';

export const BrowserManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Open a URL in the in-app browser sidebar. Opens the panel automatically if it is closed.',
      name: BrowserApiName.navigate,
      parameters: {
        properties: {
          url: {
            description: 'Absolute URL to open (http/https).',
            type: 'string',
          },
        },
        required: ['url'],
        type: 'object',
      },
    },
    {
      description:
        'Capture an accessibility snapshot of the current page: interactive elements (links, buttons, inputs, headings) with stable refs like [ref=e12] for use in click/fill. Always snapshot before acting, and re-snapshot after the page changes.',
      name: BrowserApiName.snapshot,
      parameters: {
        properties: {},
        type: 'object',
      },
    },
    {
      description:
        'Click an element. Prefer a ref from the latest snapshot; viewport x/y coordinates are a fallback for canvas-like surfaces.',
      name: BrowserApiName.click,
      parameters: {
        properties: {
          ref: {
            description: 'Element ref from the latest snapshot, e.g. "e12".',
            type: 'string',
          },
          x: {
            description: 'Viewport x coordinate (only when no ref is available).',
            type: 'number',
          },
          y: {
            description: 'Viewport y coordinate (only when no ref is available).',
            type: 'number',
          },
        },
        type: 'object',
      },
    },
    {
      description:
        'Fill a text input, textarea, or contenteditable identified by a snapshot ref. Set submit=true to press Enter afterwards.',
      name: BrowserApiName.fill,
      parameters: {
        properties: {
          ref: {
            description: 'Element ref from the latest snapshot.',
            type: 'string',
          },
          submit: {
            description: 'Press Enter after filling (submit search/login forms).',
            type: 'boolean',
          },
          text: {
            description: 'Text to fill.',
            type: 'string',
          },
        },
        required: ['ref', 'text'],
        type: 'object',
      },
    },
    {
      description: 'Send a keyboard key to the page, e.g. Enter, Tab, Escape, ArrowDown.',
      name: BrowserApiName.press,
      parameters: {
        properties: {
          key: {
            description: 'KeyboardEvent.key value (Enter, Tab, Escape, ArrowDown, ...).',
            type: 'string',
          },
        },
        required: ['key'],
        type: 'object',
      },
    },
    {
      description: 'Scroll the page vertically (positive dy scrolls down) or horizontally.',
      name: BrowserApiName.scroll,
      parameters: {
        properties: {
          dx: {
            description: 'Horizontal pixels to scroll.',
            type: 'number',
          },
          dy: {
            description: 'Vertical pixels to scroll. Positive scrolls down.',
            type: 'number',
          },
        },
        required: ['dy'],
        type: 'object',
      },
    },
    {
      description:
        'Capture a screenshot of the current page for the USER to see in chat. You cannot see the image yourself — use snapshot/readPage for perception.',
      name: BrowserApiName.screenshot,
      parameters: {
        properties: {},
        type: 'object',
      },
    },
    {
      description:
        'Extract the readable text content of the current page (for quoting or summarizing).',
      name: BrowserApiName.readPage,
      parameters: {
        properties: {},
        type: 'object',
      },
    },
  ],
  // `client`: runs in the desktop renderer (local runtime). `server`: cloud
  // agent runs proxy each call back to the bound device via deviceGateway.
  executors: ['client', 'server'],
  identifier: BrowserIdentifier,
  meta: {
    avatar: '🌐',
    description:
      'Drive the in-app browser sidebar: navigate, inspect pages via accessibility snapshots, click, fill forms, and capture screenshots — visible to the user in real time.',
    title: 'Browser',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
