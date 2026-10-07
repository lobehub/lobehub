'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { type ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
  `,
  hint: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  label: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  tile: css`
    min-width: 0;
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  value: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeHeading4};
    font-weight: ${cssVar.fontWeightStrong};
    font-variant-numeric: tabular-nums;
    line-height: 1.3;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

export interface StatTileProps {
  hint?: ReactNode;
  label: ReactNode;
  /** Tint the value for a state (pass / fail) — always alongside a label. */
  tone?: 'error' | 'success' | 'warning';
  value: ReactNode;
}

const TONE_COLOR = {
  error: cssVar.colorError,
  success: cssVar.colorSuccess,
  warning: cssVar.colorWarning,
};

export const StatTile = ({ hint, label, tone, value }: StatTileProps) => (
  <Flexbox className={styles.tile} gap={4}>
    <span className={styles.label}>{label}</span>
    <span className={styles.value} style={tone ? { color: TONE_COLOR[tone] } : undefined}>
      {value}
    </span>
    {hint && <span className={styles.hint}>{hint}</span>}
  </Flexbox>
);

/** Responsive grid of `StatTile`s. */
export const StatGrid = ({ children }: { children: ReactNode }) => (
  <div className={styles.grid}>{children}</div>
);
