'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';

import { inspectorTextStyles, shinyTextStyles } from '../../styles';
import { type ParsedTwitterTool, parseTwitterToolName, staticTwitterLabelFor } from './labels';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: stretch;

    min-width: 0;
    margin-inline-start: 6px;
    border-radius: 999px;

    font-size: 12px;
    line-height: 18px;

    background: ${cssVar.colorFillTertiary};
  `,
  chipAction: css`
    flex-shrink: 0;
    padding-block: 2px;
    padding-inline: 10px;
    color: ${cssVar.colorText};
  `,
  chipDivider: css`
    flex-shrink: 0;
    align-self: stretch;
    width: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  chipKey: css`
    color: ${cssVar.colorTextDescription};
  `,
  chipValue: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    gap: 4px;
    align-items: center;

    min-width: 0;
    padding-block: 2px;
    padding-inline: 10px;

    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorText};
  `,
  chipValueText: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  icon: css`
    flex-shrink: 0;
    margin-inline-end: 6px;
    color: ${cssVar.colorTextDescription};
  `,
  productPrefix: css`
    flex-shrink: 0;

    margin-inline-end: 2px;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const XLogomark = memo<{ size?: number }>(({ size = 14 }) => (
  <svg
    aria-hidden="true"
    className={styles.icon}
    height={size}
    viewBox="0 0 1200 1227"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M714.163 519.284 1160.89 0h-105.86L667.137 450.887 357.328 0H0l468.492 681.821L0 1226.37h105.866l409.625-476.152 327.181 476.152H1200L714.137 519.284h.026Zm-145 168.544-47.468-67.894L144.011 79.694h162.604l304.797 435.991 47.468 67.894 396.2 566.721H892.476L569.165 687.854Z"
      fill="currentColor"
    />
  </svg>
));
XLogomark.displayName = 'XLogomark';

const labelFor = (parsed: ParsedTwitterTool): string => staticTwitterLabelFor(parsed);

const truncate = (value: string, max = 60): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const stringArg = (args: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = args?.[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return undefined;
};

interface Chip {
  key?: string;
  value: string;
}

const PRIMARY_MAX = 60;

// Twitter-specific arg priority — tweet IDs and usernames first, then text-
// shaped fields (query, text, content) for search/post-style calls.
const PRIMARY_KEYS_ORDERED = [
  'tweetId',
  'tweet_id',
  'id',
  'username',
  'userId',
  'user_id',
  'screen_name',
  'handle',
  'query',
  'q',
  'text',
  'content',
  'status',
  'message',
  'listId',
  'list_id',
  'name',
];

const pickPrimaryChip = (args: Record<string, unknown> | undefined): Chip | null => {
  if (!args) return null;

  for (const key of PRIMARY_KEYS_ORDERED) {
    const value = stringArg(args, key);
    if (value) return { key, value: truncate(value, PRIMARY_MAX) };
  }

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length > 0) {
      return { key, value: truncate(value, PRIMARY_MAX) };
    }
  }
  return null;
};

const TwitterInspectorImpl = memo<BuiltinInspectorProps<Record<string, unknown>>>(
  ({ apiName, args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const effectiveArgs = args ?? partialArgs;
    const parsed = parseTwitterToolName(apiName);
    const label = labelFor(parsed);
    const primary = pickPrimaryChip(effectiveArgs);

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <XLogomark />
        <span className={styles.productPrefix}>X (Twitter)</span>
        <span className={styles.chip}>
          <span className={styles.chipAction}>{label}</span>
          {primary && (
            <>
              <span className={styles.chipDivider} />
              <span className={styles.chipValue}>
                {primary.key && <span className={styles.chipKey}>{primary.key}:</span>}
                <span className={styles.chipValueText}>{primary.value}</span>
              </span>
            </>
          )}
        </span>
      </div>
    );
  },
);
TwitterInspectorImpl.displayName = 'TwitterInspector';

export const TwitterInspector = TwitterInspectorImpl as unknown as BuiltinInspector;
