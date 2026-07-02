'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { type CSSProperties } from 'react';
import { memo, useEffect } from 'react';

import { CONVERSATION_MIN_WIDTH } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    flex-grow: 1;
    align-self: center;
    transition: width 0.25s ${cssVar.motionEaseInOut};
  `,
}));

interface WideScreenContainerProps extends FlexboxProps {
  /**
   * Force the inner column to span the full available width, bypassing the
   * centered `min(CONVERSATION_MIN_WIDTH, 100%)` cap. Used e.g. while
   * multi-selecting so the clickable rows fill the whole stream.
   */
  fullWidth?: boolean;
  minWidth?: number;
  onChange?: () => void;
  wrapperStyle?: CSSProperties;
}

const WideScreenContainer = memo<WideScreenContainerProps>(
  ({ children, className, onChange, wrapperStyle, onClick, minWidth, fullWidth, ...rest }) => {
    const wideScreen = useGlobalStore(systemStatusSelectors.wideScreen);

    useEffect(() => {
      onChange?.();
    }, [wideScreen]);

    return (
      <Flexbox style={wrapperStyle} width={'100%'} onClick={onClick}>
        <Flexbox
          className={cx(styles.container, className)}
          paddingInline={fullWidth ? 0 : 16}
          width={
            fullWidth || wideScreen ? '100%' : `min(${minWidth || CONVERSATION_MIN_WIDTH}px, 100%)`
          }
          {...rest}
        >
          {children}
        </Flexbox>
      </Flexbox>
    );
  },
  isEqual,
);

export default WideScreenContainer;
