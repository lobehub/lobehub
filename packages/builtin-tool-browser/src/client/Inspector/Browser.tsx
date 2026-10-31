'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import {
  Camera,
  Globe,
  Keyboard,
  Monitor,
  MousePointerClick,
  MoveVertical,
  ScanText,
  TextCursorInput,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { BrowserApiNameType } from '../../types';
import { BrowserApiName } from '../../types';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
    marginInlineStart: '6px',
    paddingBlock: '2px',
    paddingInline: '10px',
    borderRadius: '999px',
    background: cssVar.colorFillTertiary,
  },
  icon: { flexShrink: 0, color: cssVar.colorTextDescription },
  value: {
    overflow: 'hidden',
    minWidth: '0',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

interface BrowserArgs {
  dx?: number;
  dy?: number;
  height?: number;
  key?: string;
  ref?: string;
  text?: string;
  url?: string;
  width?: number;
  x?: number;
  y?: number;
}

const API_ICONS: Record<BrowserApiNameType, LucideIcon> = {
  [BrowserApiName.click]: MousePointerClick,
  [BrowserApiName.fill]: TextCursorInput,
  [BrowserApiName.navigate]: Globe,
  [BrowserApiName.press]: Keyboard,
  [BrowserApiName.readPage]: ScanText,
  [BrowserApiName.screenshot]: Camera,
  [BrowserApiName.scroll]: MoveVertical,
  [BrowserApiName.setViewport]: Monitor,
  [BrowserApiName.snapshot]: ScanText,
};

const stripProtocol = (url: string): string => url.replace(/^https?:\/\//i, '');

const formatScroll = ({ dx, dy }: BrowserArgs): string => {
  const parts: string[] = [];
  if (typeof dy === 'number' && dy !== 0) parts.push(`${dy > 0 ? '↓' : '↑'} ${Math.abs(dy)}px`);
  if (typeof dx === 'number' && dx !== 0) parts.push(`${dx > 0 ? '→' : '←'} ${Math.abs(dx)}px`);
  return parts.join('  ');
};

const getChipValue = (apiName: BrowserApiNameType, args: BrowserArgs): string => {
  switch (apiName) {
    case BrowserApiName.navigate: {
      return args.url ? stripProtocol(args.url.trim()) : '';
    }
    case BrowserApiName.click: {
      if (args.ref) return args.ref;
      return typeof args.x === 'number' && typeof args.y === 'number'
        ? `(${args.x}, ${args.y})`
        : '';
    }
    case BrowserApiName.fill: {
      return args.text?.trim() || args.ref || '';
    }
    case BrowserApiName.press: {
      return args.key || '';
    }
    case BrowserApiName.scroll: {
      return formatScroll(args);
    }
    case BrowserApiName.setViewport: {
      const { height, width } = args;
      return typeof width === 'number' && typeof height === 'number' ? `${width}×${height}` : '';
    }
    default: {
      return '';
    }
  }
};

export const BrowserInspector = memo<BuiltinInspectorProps<BrowserArgs>>(
  ({ apiName, args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const browserApiName = apiName as BrowserApiNameType;
    const label = t(`builtins.lobe-browser.apiName.${browserApiName}` as any);
    const value = getChipValue(browserApiName, args || partialArgs || {});
    const Icon = API_ICONS[browserApiName];

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {value ? `${label}:` : label}
        </span>
        {value && Icon && (
          <span {...stylex.props(styles.chip)}>
            <Icon className={stylex.props(styles.icon).className} size={14} />
            <span {...stylex.props(styles.value)}>{value}</span>
          </span>
        )}
      </div>
    );
  },
);

BrowserInspector.displayName = 'BrowserInspector';
