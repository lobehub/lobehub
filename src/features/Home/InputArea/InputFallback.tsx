import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowUpIcon, PlusIcon } from 'lucide-react';
import { type ChangeEventHandler, type CompositionEventHandler, memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { HomeMode } from '../types';
import {
  HOME_INPUT_ACTION_BAR_HEIGHT,
  HOME_INPUT_BOTTOM_PADDING,
  HOME_INPUT_FRAME_HEIGHT,
} from './constants';
import ModeSelect from './ModeSelect';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionBar: css`
    flex: none;

    box-sizing: border-box;
    width: 100%;
    height: ${HOME_INPUT_ACTION_BAR_HEIGHT}px;
    padding-block: 4px;
    padding-inline: 8px;
  `,
  frame: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    box-sizing: border-box;
    width: 100%;
    height: ${HOME_INPUT_FRAME_HEIGHT}px;
    border: 1px solid ${cssVar.colorFill};
    border-radius: 20px;

    background: ${cssVar.colorBgElevated};
    box-shadow: 0 12px 32px rgb(0 0 0 / 4%);
  `,
  root: css`
    box-sizing: border-box;
    width: 100%;
    height: ${HOME_INPUT_FRAME_HEIGHT + HOME_INPUT_BOTTOM_PADDING}px;
    padding-block-end: ${HOME_INPUT_BOTTOM_PADDING}px;
  `,
  textarea: css`
    resize: none;

    display: block;
    flex: 1;

    box-sizing: border-box;
    width: 100%;
    min-height: 0;
    padding-block: 8px 0;
    padding-inline: 12px;
    border: 0;

    font-family: inherit;
    font-size: 14px;
    line-height: 1.4;
    color: ${cssVar.colorText};

    background: transparent;
    outline: 0;

    &::placeholder {
      color: ${cssVar.colorTextPlaceholder};
    }
  `,
}));

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
      <div aria-busy className={styles.root} data-testid="home-input-fallback">
        <div className={styles.frame}>
          <textarea
            autoFocus
            aria-label={placeholder}
            className={styles.textarea}
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
            className={styles.actionBar}
            justify="space-between"
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
