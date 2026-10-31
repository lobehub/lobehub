'use client';

import { cx, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check } from 'lucide-react';
import { memo } from 'react';

const styles = stylex.create({
  option: {
    cursor: 'pointer',
    paddingBlock: '10px',
    paddingInline: '12px',
    borderRadius: '8px',
    transition: 'background 0.12s ease',
    background: { 'default': null, ':hover': cssVar.colorFillQuaternary },
  },
  optionCheck: { flexShrink: 0, color: cssVar.colorPrimary },
  optionDescription: { fontSize: '12px', lineHeight: 1.45, color: cssVar.colorTextSecondary },
  optionIndex: {
    flexShrink: 0,
    boxSizing: 'border-box',
    width: '22px',
    height: '22px',
    borderRadius: '6px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    fontWeight: 600,
    lineHeight: '22px',
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
    background: cssVar.colorFillTertiary,
  },
  optionHighlighted: { boxShadow: `inset 0 0 0 1px ${cssVar.colorBorder}` },
  optionLabel: { fontWeight: 500 },
  optionSelected: {
    background: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillTertiary },
  },
  recommendedBadge: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '11px',
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
    background: cssVar.colorFillSecondary,
  },
});

export interface OptionCardProps {
  description?: string;
  disabled?: boolean;
  /** Keyboard cursor (↑/↓) — independent from `selected`, which is the pick. */
  highlighted?: boolean;
  index: number;
  label: string;
  onToggle: () => void;
  /** Badge text rendered after the label for a model-recommended option. */
  recommendedText?: string;
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
  ({ index, label, description, highlighted, recommendedText, selected, disabled, onToggle }) => (
    <Flexbox
      horizontal
      align="center"
      aria-selected={selected}
      gap={12}
      role="option"
      className={cx(
        stylex.props(
          styles.option,
          selected && styles.optionSelected,
          highlighted && styles.optionHighlighted,
        ).className,
      )}
      onClick={() => {
        if (!disabled) onToggle();
      }}
    >
      <span {...stylex.props(styles.optionIndex)}>{index}</span>
      <Flexbox flex={1} gap={2}>
        <Flexbox horizontal align="center" gap={8}>
          <Text className={stylex.props(styles.optionLabel).className}>{label}</Text>
          {recommendedText && (
            <span {...stylex.props(styles.recommendedBadge)}>{recommendedText}</span>
          )}
        </Flexbox>
        {description && <span {...stylex.props(styles.optionDescription)}>{description}</span>}
      </Flexbox>
      {selected && (
        <Icon className={stylex.props(styles.optionCheck).className} icon={Check} size={16} />
      )}
    </Flexbox>
  ),
);

OptionCard.displayName = 'OptionCard';

export default OptionCard;
