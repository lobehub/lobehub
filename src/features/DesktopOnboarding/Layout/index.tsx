'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Center, Divider, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type FC, type PropsWithChildren } from 'react';

import SimpleTitleBar from '@/features/Electron/titlebar/SimpleTitleBar';
import LangButton from '@/features/User/UserPanel/LangButton';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import { useIsDark } from '@/hooks/useIsDark';
import { isMacOSWithLargeWindowBorders } from '@/utils/platform';

import { styles } from './style';

const OnboardingContainer: FC<PropsWithChildren> = ({ children }) => {
  const isDarkMode = useIsDark();
  return (
    <Flexbox height={'100%'} width={'100%'}>
      <SimpleTitleBar />
      <Flexbox
        className={stylex.props(styles.outerContainer).className}
        height={`calc(100% - ${TITLE_BAR_HEIGHT}px)`}
        style={{ paddingBottom: 8, paddingInline: 8 }}
        width={'100%'}
      >
        <Flexbox
          height={'100%'}
          width={'100%'}
          className={
            stylex.props(
              isDarkMode ? styles.innerContainerDark : styles.innerContainerLight,
              isMacOSWithLargeWindowBorders() && styles.innerContainerLargeWindowBorders,
            ).className
          }
        >
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            justify={'space-between'}
            padding={16}
            width={'100%'}
          >
            <div />
            <Flexbox horizontal align={'center'}>
              <LangButton compact placement={'bottomRight'} />
              <Divider orientation={'vertical'} style={{ height: 24, marginInline: 8 }} />
              <ThemeButton placement={'bottomRight'} size={18} />
            </Flexbox>
          </Flexbox>
          <Flexbox
            align={'center'}
            className={stylex.props(styles.contentContainer).className}
            height={'100%'}
            width={'100%'}
          >
            {children}
          </Flexbox>
          <Center padding={24}>
            <Text align={'center'} type={'secondary'}>
              © 2026 LobeHub. All rights reserved.
            </Text>
          </Center>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

export default OnboardingContainer;
