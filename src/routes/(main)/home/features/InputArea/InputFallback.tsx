import { Flexbox, Skeleton } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type ChangeEventHandler, type CompositionEventHandler, memo } from 'react';

import {
  HOME_INPUT_ACTION_BAR_HEIGHT,
  HOME_INPUT_BOTTOM_PADDING,
  HOME_INPUT_FRAME_HEIGHT,
} from './constants';

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
  onCompositionEnd: CompositionEventHandler<HTMLTextAreaElement>;
  onCompositionStart: CompositionEventHandler<HTMLTextAreaElement>;
  onValueChange: (value: string) => void;
  placeholder?: string;
  value: string;
}

const InputFallback = memo<InputFallbackProps>(
  ({ onCompositionEnd, onCompositionStart, onValueChange, placeholder, value }) => {
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
              <Skeleton.Button
                active
                shape="circle"
                size="small"
                style={{ height: 28, minWidth: 28, width: 28 }}
              />
              <Skeleton.Button
                active
                shape="circle"
                size="small"
                style={{ height: 28, minWidth: 28, width: 28 }}
              />
            </Flexbox>
            <Skeleton.Button
              active
              shape="round"
              size="small"
              style={{ height: 32, minWidth: 64, width: 64 }}
            />
          </Flexbox>
        </div>
      </div>
    );
  },
);

InputFallback.displayName = 'InputFallback';

export default InputFallback;
