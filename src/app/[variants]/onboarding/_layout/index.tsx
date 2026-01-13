'use client';

import { Center, Flexbox, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { cx } from 'antd-style';
import type { FC, PropsWithChildren } from 'react';

import LangButton from '@/features/User/UserPanel/LangButton';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import { useIsDark } from '@/hooks/useIsDark';

import { styles } from './style';

const OnBoardingContainer: FC<PropsWithChildren> = ({ children }) => {
  const isDarkMode = useIsDark();
  return (
    <Flexbox className={styles.outerContainer} height={'100%'} padding={8} width={'100%'}>
      <Flexbox
        className={cx(isDarkMode ? styles.innerContainerDark : styles.innerContainerLight)}
        height={'100%'}
        width={'100%'}
      >
        <Flexbox
          align={'center'}
          gap={8}
          horizontal
          justify={'space-between'}
          padding={16}
          width={'100%'}
        >
          <div />
          <Flexbox align={'center'} horizontal>
            <LangButton placement={'bottomRight'} size={18} />
            <Divider className={styles.divider} orientation={'vertical'} />
            <ThemeButton placement={'bottomRight'} size={18} />
          </Flexbox>
        </Flexbox>
        <Center height={'100%'} padding={16} width={'100%'}>
          {children}
        </Center>
        <Center padding={24}>
          <Text align={'center'} type={'secondary'}>
            © 2025 LobeHub. All rights reserved.
          </Text>
        </Center>
      </Flexbox>
    </Flexbox>
  );
};

OnBoardingContainer.displayName = 'OnBoardingContainer';

export default OnBoardingContainer;
