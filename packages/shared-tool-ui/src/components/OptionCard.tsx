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
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  checkbox: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    width: '16px',
    height: '16px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '4px',
  },
  checkboxChecked: {
    color: cssVar.colorBgContainer,
    backgroundColor: cssVar.colorText,
    backgroundImage: 'none',
    borderColor: cssVar.colorText,
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
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  optionHighlighted: { boxShadow: `inset 0 0 0 1px ${cssVar.colorBorder}` },
  optionLabel: { fontWeight: 500 },
  optionSelected: {
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  recommendedBadge: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '999px',
    fontSize: '11px',
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
});

export interface OptionCardProps {
  description?: string;
  disabled?: boolean;
  /** Keyboard cursor (↑/↓) — independent from `selected`, which is the pick. */
  highlighted?: boolean;
  index: number;
  label: string;
  multiSelect?: boolean;
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
  ({
    index,
    label,
    description,
    highlighted,
    multiSelect,
    recommendedText,
    selected,
    disabled,
    onToggle,
  }) => (
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
      {multiSelect ? (
        <span {...stylex.props(styles.checkbox, selected && styles.checkboxChecked)}>
          {selected && <Icon icon={Check} size={{ size: 12, strokeWidth: 3 }} />}
        </span>
      ) : (
        selected && (
          <Icon className={stylex.props(styles.optionCheck).className} icon={Check} size={16} />
        )
      )}
    </Flexbox>
  ),
);

OptionCard.displayName = 'OptionCard';

export default OptionCard;
