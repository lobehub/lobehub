'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { CONVERSATION_MIN_WIDTH } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { sx } from '@/styles/sx';

const styles = stylex.create({
  container: { flexGrow: 1, alignSelf: 'center' },
});

const ConversationSkeletonContainer = ({
  children,
  className,
  flex,
  height,
  ...rest
}: FlexboxProps) => {
  const wideScreen = useGlobalStore(systemStatusSelectors.wideScreen);

  return (
    <Flexbox aria-busy flex={flex} height={height} style={{ minHeight: 0 }} width={'100%'}>
      <Flexbox
        {...sx([styles.container], className)}
        flex={flex}
        height={height}
        paddingInline={16}
        width={wideScreen ? '100%' : `min(${CONVERSATION_MIN_WIDTH}px, 100%)`}
        {...rest}
      >
        {children}
      </Flexbox>
    </Flexbox>
  );
};

export default ConversationSkeletonContainer;
