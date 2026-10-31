'use client';

import { Block, Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { HTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

const styles = stylex.create({
  list: { overflow: 'hidden', width: '100%', padding: 0 },
  row: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockStartWidth: { default: null, [stylex.when.siblingBefore(':is(*)')]: '1px' },
    borderBlockStartStyle: { default: null, [stylex.when.siblingBefore(':is(*)')]: 'solid' },
    borderBlockStartColor: {
      default: null,
      [stylex.when.siblingBefore(':is(*)')]: cssVar.colorBorderSecondary,
    },
  },
  rowClickable: {
    cursor: 'pointer',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  seq: { flex: 'none', fontSize: '12px', color: cssVar.colorTextTertiary },
});

interface CriterionRequiredChipProps {
  /** When set, the chip becomes the required/optional toggle. */
  onToggle?: () => void;
  required: boolean;
}

/** The shared required ("必选") / optional chip: blue when the criterion blocks acceptance. */
export const CriterionRequiredChip = ({ onToggle, required }: CriterionRequiredChipProps) => {
  const { t } = useTranslation('verify');

  return (
    <Tag
      color={required ? 'info' : undefined}
      size={'small'}
      style={onToggle ? { cursor: 'pointer' } : undefined}
      variant={'filled'}
      onClick={
        onToggle
          ? (event) => {
              event.stopPropagation();
              onToggle();
            }
          : undefined
      }
    >
      {t(required ? 'criterion.required' : 'criterion.optional')}
    </Tag>
  );
};

/**
 * Keyboard activation for the row. A nested action control's Enter/Space
 * bubbles up here; acting on it would open the row on top of (or instead of)
 * the control's own click, so only events originating from the row itself
 * activate it.
 */
export const rowKeyDownHandler =
  (onOpen: () => void) => (event: { currentTarget: unknown; key: string; target: unknown }) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') onOpen();
  };

export interface CriterionRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** e2e / automation anchors, forwarded onto the row element. */
  [dataAttribute: `data-${string}`]: string | undefined;
  /** Trailing controls (edit / delete). Handlers must stopPropagation themselves. */
  actions?: ReactNode;
  /** Chips rendered between the title and the actions (required chip, verifier tag …). */
  children?: ReactNode;
  /** Leading status icon; omit for plain draft rows. */
  icon?: ReactNode;
  onOpen?: () => void;
  /** 1-based position, rendered as the C{seq} anchor. */
  seq?: number | string;
  title: string;
}

/**
 * One acceptance-criterion row — the single list grammar (icon + C{seq} + title
 * + chips + actions) shared by goal creation, task verify config, and the
 * acceptance check lists.
 */
export const CriterionRow = ({
  actions,
  children,
  className,
  icon,
  onOpen,
  seq,
  title,
  ...rest
}: CriterionRowProps) => (
  <Flexbox
    horizontal
    align={'center'}
    gap={10}
    {...sx([styles.row, stylex.defaultMarker(), onOpen && styles.rowClickable], className)}
    role={onOpen ? 'button' : undefined}
    tabIndex={onOpen ? 0 : undefined}
    onClick={onOpen}
    onKeyDown={onOpen && rowKeyDownHandler(onOpen)}
    {...rest}
  >
    {icon}
    {seq !== undefined && <span {...stylex.props(styles.seq)}>C{seq}</span>}
    <Text ellipsis style={{ flex: 1, minWidth: 0 }}>
      {title}
    </Text>
    {children}
    {actions}
  </Flexbox>
);

interface CriterionListProps {
  children: ReactNode;
  className?: string;
}

/** Outlined container that gives `CriterionRow` children their between-row borders. */
export const CriterionList = ({ children, className }: CriterionListProps) => (
  <Block {...sx([styles.list], className)} variant={'outlined'}>
    {children}
  </Block>
);
