'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import {
  Camera,
  Globe,
  Keyboard,
  MousePointerClick,
  MoveVertical,
  ScanText,
  TextCursorInput,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  BROWSER_MCP_TOOL_NAMES,
  type BrowserMcpApi,
  browserMcpLabelFallback,
  browserMcpLabelKey,
  isBrowserMcpApiName,
  parseBrowserMcpApi,
} from './browserMcpLabels';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    gap: 6px;
    align-items: center;

    min-width: 0;
    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 999px;

    background: ${cssVar.colorFillTertiary};
  `,
  icon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextDescription};
  `,
  value: css`
    overflow: hidden;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface BrowserMcpArgs {
  dx?: number;
  dy?: number;
  key?: string;
  ref?: string;
  text?: string;
  url?: string;
  x?: number;
  y?: number;
}

const API_ICONS: Record<BrowserMcpApi, LucideIcon> = {
  click: MousePointerClick,
  fill: TextCursorInput,
  navigate: Globe,
  press: Keyboard,
  readPage: ScanText,
  screenshot: Camera,
  scroll: MoveVertical,
  snapshot: ScanText,
};

/** Lead with the host — `https://` is noise and eats the chip's width. */
const stripProtocol = (url: string): string => url.replace(/^https?:\/\//i, '');

/** Arrow + distance reads in any locale, unlike "Scrolled down 500px". */
const formatScroll = ({ dx, dy }: BrowserMcpArgs): string => {
  const parts: string[] = [];
  if (typeof dy === 'number' && dy !== 0) parts.push(`${dy > 0 ? '↓' : '↑'} ${Math.abs(dy)}px`);
  if (typeof dx === 'number' && dx !== 0) parts.push(`${dx > 0 ? '→' : '←'} ${Math.abs(dx)}px`);
  return parts.join('  ');
};

/**
 * The one detail worth putting on the collapsed row. Screenshot / snapshot /
 * readPage take no arguments — their label already says everything, so they get
 * no chip rather than an empty one.
 */
const getChipValue = (api: BrowserMcpApi, args: BrowserMcpArgs): string => {
  switch (api) {
    case 'navigate': {
      return args.url ? stripProtocol(args.url.trim()) : '';
    }
    case 'click': {
      if (args.ref) return args.ref;
      const { x, y } = args;
      return typeof x === 'number' && typeof y === 'number' ? `(${x}, ${y})` : '';
    }
    case 'fill': {
      return args.text?.trim() || args.ref || '';
    }
    case 'press': {
      return args.key || '';
    }
    case 'scroll': {
      return formatScroll(args);
    }
    default: {
      return '';
    }
  }
};

/**
 * One inspector for every `mcp__lobe_cc__browser_*` call. Without it the row
 * falls back to the raw wire name (`claude-code > mcp__lobe_cc__browser_navigate`),
 * which reads like an internal identifier rather than "the agent opened a page".
 */
const BrowserMcpInspector = memo<BuiltinInspectorProps<BrowserMcpArgs>>(
  ({ apiName, args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('chat');
    const api = parseBrowserMcpApi(apiName);
    if (!api) return null;

    const label = t(browserMcpLabelKey(api) as any, {
      defaultValue: browserMcpLabelFallback(api),
    });
    const value = getChipValue(api, args || partialArgs || {});
    const Icon = API_ICONS[api];

    const isShiny = isArgumentsStreaming || isLoading;

    return (
      <div className={cx(inspectorTextStyles.root, isShiny && shinyTextStyles.shinyText)}>
        <span>{value ? `${label}:` : label}</span>
        {value && (
          <span className={styles.chip}>
            <Icon className={styles.icon} size={14} />
            <span className={styles.value}>{value}</span>
          </span>
        )}
      </div>
    );
  },
);

BrowserMcpInspector.displayName = 'ClaudeCodeBrowserMcpInspector';

// `BuiltinInspector` is generic over its args; the registry only ever hands it
// the parsed args of the call it's keyed under (same cast as `LinearRender`).
const Inspector = BrowserMcpInspector as unknown as BuiltinInspector;

const FixedBrowserMcpInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  BROWSER_MCP_TOOL_NAMES.map((tool) => [tool, Inspector]),
);

// Proxy-guarded like the Linear map so a tool added to the desktop's MCP server
// without a matching entry here still resolves (rather than silently falling
// back to the raw wire name).
export const BrowserMcpInspectors: Record<string, BuiltinInspector> = new Proxy(
  FixedBrowserMcpInspectors,
  {
    get: (target, prop) => {
      if (typeof prop !== 'string') return undefined;
      return target[prop] || (isBrowserMcpApiName(prop) ? Inspector : undefined);
    },
  },
);
