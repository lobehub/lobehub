import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpIcon, PlusIcon } from 'lucide-react';
import { type ChangeEventHandler, type CompositionEventHandler, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import type { HomeMode } from '../types';
import {
  HOME_INPUT_ACTION_BAR_HEIGHT,
  HOME_INPUT_BOTTOM_PADDING,
  HOME_INPUT_FRAME_HEIGHT,
} from './constants';
import ModeSelect from './ModeSelect';

const styles = stylex.create({
  actionBar: {
    flex: 'none',
    boxSizing: 'border-box',
    width: '100%',
    paddingBlock: '4px',
    paddingInline: '8px',
  },
  frame: {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorFill,
    borderRadius: '20px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: '0 12px 32px rgb(0 0 0 / 4%)',
  },
  root: {
    boxSizing: 'border-box',
    width: '100%',
  },
  textarea: {
    'resize': 'none',
    'display': 'block',
    'flex': '1',
    'boxSizing': 'border-box',
    'width': '100%',
    'minHeight': 0,
    'paddingBlockStart': '8px',
    'paddingBlockEnd': 0,
    'paddingInline': '12px',
    'borderWidth': 0,
    'fontFamily': 'inherit',
    'fontSize': '14px',
    'lineHeight': 1.4,
    'color': cssVar.colorText,
    'backgroundColor': 'transparent',
    'backgroundImage': 'none',
    'outlineWidth': 0,
    '::placeholder': {
      color: cssVar.colorTextPlaceholder,
    },
  },
});

interface InputFallbackProps {
  isAgentConfigLoading: boolean;
  loading: boolean;
  mode: HomeMode;
  onCompositionEnd: CompositionEventHandler<HTMLTextAreaElement>;
  onCompositionStart: CompositionEventHandler<HTMLTextAreaElement>;
  onModeChange: (mode: HomeMode) => void;
  onValueChange: (value: string) => void;
  placeholder?: string;
  value: string;
}

const InputFallback = memo<InputFallbackProps>(
  ({
    isAgentConfigLoading,
    loading,
    mode,
    onCompositionEnd,
    onCompositionStart,
    onModeChange,
    onValueChange,
    placeholder,
    value,
  }) => {
    const { t } = useTranslation('common');
    const handleChange: ChangeEventHandler<HTMLTextAreaElement> = (event) => {
      onValueChange(event.currentTarget.value);
    };

    return (
      <div
        aria-busy
        data-testid="home-input-fallback"
        {...sx([styles.root], undefined, {
          height: HOME_INPUT_FRAME_HEIGHT + HOME_INPUT_BOTTOM_PADDING,
          paddingBlockEnd: HOME_INPUT_BOTTOM_PADDING,
        })}
      >
        <div {...sx([styles.frame], undefined, { height: HOME_INPUT_FRAME_HEIGHT })}>
          <textarea
            autoFocus
            aria-label={placeholder}
            {...stylex.props(styles.textarea)}
            placeholder={placeholder}
            value={value}
            onChange={handleChange}
            onCompositionEnd={onCompositionEnd}
            onCompositionStart={onCompositionStart}
          />
          <Flexbox
            aria-hidden
            horizontal
            align="center"
            justify="space-between"
            {...sx([styles.actionBar], undefined, { height: HOME_INPUT_ACTION_BAR_HEIGHT })}
          >
            <Flexbox horizontal align="center" gap={6}>
              <ModeSelect value={mode} onChange={onModeChange} />
              <ActionIcon disabled icon={PlusIcon} size={'small'} title={t('loading')} />
            </Flexbox>
            <ActionIcon
              disabled
              icon={ArrowUpIcon}
              loading={loading || isAgentConfigLoading}
              size={'small'}
              title={t('send')}
            />
          </Flexbox>
        </div>
      </div>
    );
  },
);

InputFallback.displayName = 'InputFallback';

export default InputFallback;
