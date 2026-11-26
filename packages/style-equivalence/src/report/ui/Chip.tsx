import { Tag } from '@lobehub/ui';
import type { ReactNode } from 'react';

const TONE_COLORS = {
  bad: 'error',
  info: 'info',
  ok: 'success',
  plain: undefined,
  warn: 'warning',
} as const;

export type ChipTone = keyof typeof TONE_COLORS;

export const Chip = ({
  children,
  title,
  tone,
}: {
  children: ReactNode;
  title?: string;
  tone: ChipTone;
}) => (
  <Tag color={TONE_COLORS[tone]} size="small" title={title}>
    {children}
  </Tag>
);

export const CATEGORY_TONES: Record<string, ChipTone> = {
  'blocking': 'plain',
  'difference': 'bad',
  'equal': 'ok',
  'needs-signoff': 'warn',
  'unpaired': 'warn',
};
