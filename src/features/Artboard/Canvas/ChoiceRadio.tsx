import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { artboardTokens } from '../tokens.stylex';

export const RADIO_WIDTH = 20;

export interface BoardChoice {
  checked: boolean;
  disabled: boolean;
  onPick: () => void;
}

const styles = stylex.create({
  checked: {
    borderColor: {
      ':hover': artboardTokens.accent,
      'default': artboardTokens.accent,
    },
    borderWidth: 4.5,
    cursor: 'default',
  },
  disabled: {
    borderColor: {
      ':hover': cssVar.colorTextQuaternary,
      'default': cssVar.colorTextQuaternary,
    },
    cursor: 'default',
    opacity: 0.6,
  },
  radio: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: {
      ':hover': artboardTokens.accent,
      'default': cssVar.colorTextQuaternary,
    },
    borderRadius: '50%',
    borderStyle: 'solid',
    borderWidth: 1.5,
    boxSizing: 'border-box',
    cursor: 'pointer',
    flexShrink: 0,
    height: 14,
    marginBlockStart: 4,
    marginInlineEnd: 6,
    pointerEvents: 'auto',
    width: 14,
  },
});

const ChoiceRadio = ({ checked, disabled, onPick }: BoardChoice) => (
  <span
    aria-checked={checked}
    aria-disabled={disabled}
    role="radio"
    {...stylex.props(styles.radio, disabled && styles.disabled, checked && styles.checked)}
    onClick={(event) => {
      event.stopPropagation();
      if (!disabled && !checked) onPick();
    }}
  />
);

export default ChoiceRadio;
