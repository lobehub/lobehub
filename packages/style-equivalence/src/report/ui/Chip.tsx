import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';

const styles = stylex.create({
  chip: {
    alignItems: 'center',
    borderRadius: 4,
    display: 'inline-flex',
    fontSize: 12,
    fontWeight: 500,
    height: 20,
    paddingInline: 6,
    whiteSpace: 'nowrap',
  },
});

const tones = stylex.create({
  bad: { backgroundColor: cssVar.colorErrorBg, color: cssVar.colorError },
  info: { backgroundColor: cssVar.colorInfoBg, color: cssVar.colorInfo },
  ok: { backgroundColor: cssVar.colorSuccessBg, color: cssVar.colorSuccess },
  plain: { backgroundColor: cssVar.colorFillTertiary, color: cssVar.colorTextSecondary },
  warn: { backgroundColor: cssVar.colorWarningBg, color: cssVar.colorWarning },
});

export type ChipTone = keyof typeof tones;

export const Chip = ({
  children,
  title,
  tone,
}: {
  children: ReactNode;
  title?: string;
  tone: ChipTone;
}) => (
  <span title={title} {...stylex.props(styles.chip, tones[tone])}>
    {children}
  </span>
);

export const CATEGORY_TONES: Record<string, ChipTone> = {
  'blocking': 'plain',
  'difference': 'bad',
  'equal': 'ok',
  'needs-signoff': 'warn',
  'unpaired': 'warn',
};
