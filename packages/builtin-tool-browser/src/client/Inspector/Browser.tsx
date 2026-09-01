'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
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

import type { BrowserApiNameType } from '../../types';
import { BrowserApiName } from '../../types';

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

interface BrowserArgs {
  dx?: number;
  dy?: number;
  key?: string;
  ref?: string;
  text?: string;
  url?: string;
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
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{value ? `${label}:` : label}</span>
        {value && Icon && (
          <span className={styles.chip}>
            <Icon className={styles.icon} size={14} />
            <span className={styles.value}>{value}</span>
          </span>
        )}
      </div>
    );
  },
);

BrowserInspector.displayName = 'BrowserInspector';
