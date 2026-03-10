'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Center, Flexbox, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { css, cx } from 'antd-style';
import { type FC, type PropsWithChildren } from 'react';

import SimpleTitleBar from '@/features/Electron/titlebar/SimpleTitleBar';
import LangButton from '@/features/User/UserPanel/LangButton';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import { useIsDark } from '@/hooks/useIsDark';

import { styles } from './style';

const contentContainer = css`
  overflow: auto;
`;
const OnboardingContainer: FC<PropsWithChildren> = ({ children }) => {
  const isDarkMode = useIsDark();
  return (
    <Flexbox height={'100%'} width={'100%'}>
      <SimpleTitleBar />
      <Flexbox
        className={styles.outerContainer}
        height={`calc(100% - ${TITLE_BAR_HEIGHT}px)`}
        style={{ paddingBottom: 8, paddingInline: 8 }}
        width={'100%'}
      >
        <Flexbox
          className={cx(isDarkMode ? styles.innerContainerDark : styles.innerContainerLight)}
          height={'100%'}
          width={'100%'}
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
              <LangButton placement={'bottomRight'} size={18} />
              <Divider className={styles.divider} orientation={'vertical'} />
              <ThemeButton placement={'bottomRight'} size={18} />
            </Flexbox>
          </Flexbox>
          <Flexbox align={'center'} className={cx(contentContainer)} height={'100%'} width={'100%'}>
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
