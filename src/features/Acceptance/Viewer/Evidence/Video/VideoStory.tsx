'use client';

import type { VerifyEvidenceChapterKind } from '@lobechat/types';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import type { StyleXStyles } from '@stylexjs/stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

import { CLAIM_COLOR } from './styles';
import { formatVideoClock, formatVideoTime } from './videoTime';

const styles = stylex.create({
  title: {
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: '22px',
    color: cssVar.colorText,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
  },
  chapter: {
    cursor: 'pointer',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    width: '100%',
    margin: 0,
    paddingBlockStart: '12px',
    paddingBlockEnd: '4px',
    paddingInline: 0,
    borderBlockStartWidth: '1px',
    borderBlockEndWidth: 0,
    borderInlineWidth: 0,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 0,
    fontFamily: 'inherit',
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: '20px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    textAlign: 'start',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    outline: {
      'default': 'none',
      ':focus-visible': `2px solid ${cssVar.colorPrimaryBorder}`,
    },
    appearance: 'none',
  },
  chapterFirst: {
    paddingBlockStart: 0,
    borderBlockStartWidth: 0,
  },
  mono: {
    fontFamily: cssVar.fontFamilyCode,
    fontVariantNumeric: 'tabular-nums',
  },
  chapterTime: { color: cssVar.colorTextTertiary },
  item: {
    display: 'grid',
    gridTemplateColumns: '20px 56px minmax(0, 1fr)',
    rowGap: '4px',
    columnGap: '8px',
    alignItems: 'start',
    marginInline: '-8px',
    padding: '8px',
    borderRadius: '8px',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillQuaternary },
    backgroundImage: 'none',
  },
  itemActive: {
    backgroundColor: {
      'default': cssVar.colorFillQuaternary,
      ':hover': cssVar.colorFillTertiary,
    },
  },
  head: {
    cursor: 'pointer',
    userSelect: 'text',
    display: 'grid',
    gridColumnStart: 1,
    gridColumnEnd: -1,
    gridTemplateColumns: 'subgrid',
    alignItems: 'start',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    borderColor: 'currentcolor',
    borderRadius: '4px',
    font: 'inherit',
    color: cssVar.colorText,
    textAlign: 'start',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    outline: {
      'default': 'none',
      ':focus-visible': `2px solid ${cssVar.colorPrimaryBorder}`,
    },
    outlineOffset: '2px',
    appearance: 'none',
  },
  marker: {
    display: 'grid',
    placeItems: 'center',
    height: '22px',
  },
  time: {
    fontSize: '12px',
    lineHeight: '22px',
    color: cssVar.colorTextTertiary,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  below: {
    gridColumnStart: 3,
    minWidth: 0,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gridColumnStart: 3,
    columnGap: '12px',
    rowGap: '4px',
  },
  who: {
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
  },
  text: {
    overflowWrap: 'anywhere',
    fontSize: '14px',
    lineHeight: '22px',
    color: cssVar.colorText,
  },
  dot: {
    flex: 'none',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  dotColor: (color: string) => ({ backgroundColor: color }),
  badge: {
    flex: 'none',
    width: '20px',
    height: '20px',
    marginBlockStart: '1px',
    borderRadius: '50%',
    fontSize: '12px',
    fontWeight: 600,
    lineHeight: '20px',
    color: cssVar.colorTextLightSolid,
    textAlign: 'center',
    backgroundColor: cssVar.colorError,
    backgroundImage: 'none',
  },
  link: {
    cursor: { 'default': 'pointer', ':disabled': 'default' },
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    borderColor: 'currentcolor',
    borderRadius: '2px',
    fontFamily: 'inherit',
    fontSize: '12px',
    lineHeight: '20px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    textDecorationLine: 'underline',
    textUnderlineOffset: '2px',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    outline: {
      'default': 'none',
      ':focus-visible': `2px solid ${cssVar.colorPrimaryBorder}`,
    },
    outlineOffset: '2px',
    appearance: 'none',
  },
});

export const StoryTitle = ({ children }: { children: ReactNode }) => (
  <div {...stylex.props(styles.title)}>{children}</div>
);

export const StoryList = ({ children }: { children: ReactNode }) => (
  <div {...stylex.props(styles.list)}>{children}</div>
);

interface StoryChapterProps {
  first: boolean;
  label: string;
  onSeek: () => void;
  time: number;
}

export const StoryChapter = ({ first, label, onSeek, time }: StoryChapterProps) => (
  <button
    {...stylex.props(styles.chapter, first && styles.chapterFirst)}
    type={'button'}
    onClick={onSeek}
  >
    <span {...stylex.props(styles.mono, styles.chapterTime)}>{formatVideoClock(time)}</span>
    {label}
  </button>
);

interface StoryItemProps {
  actions?: ReactNode;
  active?: boolean;
  children?: ReactNode;
  expanded?: boolean;
  head: ReactNode;
  id?: string;
  marker: ReactNode;
  onSeek: () => void;
  time: number;
  xstyle?: StyleXStyles;
}

export const StoryItem = ({
  actions,
  active,
  children,
  expanded,
  head,
  id,
  marker,
  onSeek,
  time,
  xstyle,
}: StoryItemProps) => (
  <div {...stylex.props(styles.item, active && styles.itemActive, xstyle)} id={id}>
    <button
      aria-current={active ? 'true' : undefined}
      aria-expanded={expanded}
      {...stylex.props(styles.head)}
      type={'button'}
      onClick={onSeek}
    >
      <span {...stylex.props(styles.marker)}>{marker}</span>
      <span {...stylex.props(styles.mono, styles.time)}>{formatVideoTime(time)}</span>
      <span {...stylex.props(styles.body)}>{head}</span>
    </button>
    {children && <div {...stylex.props(styles.below)}>{children}</div>}
    {actions && <div {...stylex.props(styles.actions)}>{actions}</div>}
  </div>
);

export const StoryWho = ({ children }: { children: ReactNode }) => (
  <span {...stylex.props(styles.who)}>{children}</span>
);

export const StoryText = ({ children, xstyle }: { children: ReactNode; xstyle?: StyleXStyles }) => (
  <span {...stylex.props(styles.text, xstyle)}>{children}</span>
);

export const StoryDot = ({ kind }: { kind: VerifyEvidenceChapterKind }) => (
  <span aria-hidden {...stylex.props(styles.dot, styles.dotColor(CLAIM_COLOR[kind]))} />
);

export const StoryBadge = ({ children, color }: { children: ReactNode; color?: string }) => (
  <span {...stylex.props(styles.badge, color !== undefined && styles.dotColor(color))}>
    {children}
  </span>
);

export const StoryLink = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
  <button {...stylex.props(styles.link)} type={'button'} onClick={onClick}>
    {children}
  </button>
);
