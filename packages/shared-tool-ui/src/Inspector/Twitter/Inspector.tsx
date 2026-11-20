'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { inspectorTextStyles, shinyTextStyles } from '../../styles';
import { type ParsedTwitterTool, parseTwitterToolName, staticTwitterLabelFor } from './labels';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    alignItems: 'stretch',
    minWidth: '0',
    marginInlineStart: '6px',
    borderRadius: '999px',
    fontSize: '12px',
    lineHeight: '18px',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  chipAction: {
    flexShrink: 0,
    paddingBlock: '2px',
    paddingInline: '10px',
    color: cssVar.colorText,
  },
  chipDivider: {
    flexShrink: 0,
    alignSelf: 'stretch',
    width: '1px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  chipKey: { color: cssVar.colorTextDescription },
  chipValue: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    gap: '4px',
    alignItems: 'center',
    minWidth: '0',
    paddingBlock: '2px',
    paddingInline: '10px',
    fontFamily: cssVar.fontFamilyCode,
    color: cssVar.colorText,
  },
  chipValueText: {
    overflow: 'hidden',
    minWidth: '0',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  icon: { flexShrink: 0, marginInlineEnd: '6px', color: cssVar.colorTextDescription },
  productPrefix: {
    flexShrink: 0,
    marginInlineEnd: '2px',
    fontSize: '13px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
});

const XLogomark = memo<{ size?: number }>(({ size = 14 }) => (
  <svg
    aria-hidden="true"
    {...stylex.props(styles.icon)}
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
      <div className={inspectorTextStyles.root}>
        <XLogomark />
        <span
          className={cx(
            stylex.props(styles.productPrefix).className,
            (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
          )}
        >
          X (Twitter)
        </span>
        <span {...stylex.props(styles.chip)}>
          <span {...stylex.props(styles.chipAction)}>{label}</span>
          {primary && (
            <>
              <span {...stylex.props(styles.chipDivider)} />
              <span {...stylex.props(styles.chipValue)}>
                {primary.key && <span {...stylex.props(styles.chipKey)}>{primary.key}:</span>}
                <span {...stylex.props(styles.chipValueText)}>{primary.value}</span>
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
