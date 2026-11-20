import { ActionIcon, createStaticStyles, Flexbox } from '@lobehub/ui';
import { ArrowUpIcon, PlusIcon } from 'lucide-react';
import { type ChangeEventHandler, type CompositionEventHandler, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { densityVars } from '@/styles/densityVars';

import type { HomeMode } from '../types';
import { HOME_INPUT_BOTTOM_PADDING, HOME_INPUT_METRICS } from './constants';
import ModeSelect from './ModeSelect';

const { compact, loose } = HOME_INPUT_METRICS;

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionBar: css`
    flex: none;

    box-sizing: border-box;
    width: 100%;
    height: ${loose.actionBarHeight}px;
    padding-block: 4px;
    padding-inline: 8px;

    html[data-density='compact'] & {
      height: ${compact.actionBarHeight}px;
    }
  `,
  frame: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    box-sizing: border-box;
    width: 100%;
    height: ${loose.frameHeight}px;
    border: 1px solid ${cssVar.colorFill};
    border-radius: ${loose.radius}px;

    background: ${cssVar.colorBgElevated};
    box-shadow: 0 12px 32px rgb(0 0 0 / 4%);

    html[data-density='compact'] & {
      height: ${compact.frameHeight}px;
      border-radius: ${compact.radius}px;
    }
  `,
  root: css`
    box-sizing: border-box;
    width: 100%;
    height: ${loose.reservedHeight}px;
    padding-block-end: ${HOME_INPUT_BOTTOM_PADDING}px;

    html[data-density='compact'] & {
      height: ${compact.reservedHeight}px;
    }
  `,
  textarea: css`
    resize: none;

    display: block;
    flex: 1;

    box-sizing: border-box;
    width: 100%;
    min-height: 0;
    padding-block: 8px 0;
    padding-inline: ${densityVars.contentGap};
    border: 0;

    font-family: inherit;
    font-size: ${densityVars.fontSize};
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
