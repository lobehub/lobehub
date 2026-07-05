'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Check } from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Card sits inline with the chat — no surrounding panel chrome. Hover
  // tints the row so the stack reads as clickable; selection swaps to a
  // neutral filled row so the pick is visually weighty. We use `colorFill*`
  // rather than `colorPrimaryBg` because LobeHub's default primary is a
  // near-black neutral, which makes `colorPrimaryBg` render as a muddy black
  // block; the selection signal instead rides the filled row + the checkmark.
  option: css`
    cursor: pointer;

    padding-block: 10px;
    padding-inline: 12px;
    border-radius: 8px;

    transition: background 0.12s ease;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  optionCheck: css`
    flex-shrink: 0;
    color: ${cssVar.colorPrimary};
  `,
  optionDescription: css`
    font-size: 12px;
    line-height: 1.45;
    color: ${cssVar.colorTextSecondary};
  `,
  // Neutral 1/2/3/4 chip — stays the same colour whether selected or not so
  // the selection signal lives on the filled background + checkmark.
  optionIndex: css`
    flex-shrink: 0;

    box-sizing: border-box;
    width: 22px;
    height: 22px;
    border-radius: 6px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-weight: 600;
    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;

    background: ${cssVar.colorFillTertiary};
  `,
  optionLabel: css`
    font-weight: 500;
  `,
  optionSelected: css`
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFill};
    }
  `,
}));

export interface OptionCardProps {
  description?: string;
  disabled?: boolean;
  index: number;
  label: string;
  onToggle: () => void;
  selected: boolean;
}

/**
 * One numbered option in a question. Filled when picked, neutral otherwise;
 * a right-side checkmark seals the selection so the state reads cleanly even
 * with the number chip kept neutral.
 *
 * Presentational and self-contained — shared across the ask-user surfaces
 * (Claude Code `AskUserQuestion`, the builtin `user-interaction` /
 * `lobe-agent` clarification form) so the tiled options read identically
 * everywhere.
 */
export const OptionCard = memo<OptionCardProps>(
  ({ index, label, description, selected, disabled, onToggle }) => (
    <Flexbox
      horizontal
      align="center"
      aria-selected={selected}
      className={cx(styles.option, selected && styles.optionSelected)}
      gap={12}
      role="option"
      onClick={() => {
        if (!disabled) onToggle();
      }}
    >
      <span className={styles.optionIndex}>{index}</span>
      <Flexbox flex={1} gap={2}>
        <Text className={styles.optionLabel}>{label}</Text>
        {description && <span className={styles.optionDescription}>{description}</span>}
      </Flexbox>
      {selected && <Icon className={styles.optionCheck} icon={Check} size={16} />}
    </Flexbox>
  ),
);

OptionCard.displayName = 'OptionCard';

export default OptionCard;
