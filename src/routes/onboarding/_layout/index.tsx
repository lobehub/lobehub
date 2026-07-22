'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { cx, useTheme } from 'antd-style';
import { type FC, type PropsWithChildren, useEffect } from 'react';
import { useLocation } from 'react-router';

import { ProductLogo } from '@/components/Branding';
import LangButton from '@/features/User/UserPanel/LangButton';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import { useIsDark } from '@/hooks/useIsDark';
import { useIsMobile } from '@/hooks/useIsMobile';
import { stashOnboardingCallbackUrl } from '@/utils/onboardingRedirect';

import { styles } from './style';

const OnBoardingContainer: FC<PropsWithChildren> = ({ children }) => {
  const isDarkMode = useIsDark();
  const isMobile = useIsMobile();
  const theme = useTheme();
  const { search } = useLocation();

  // Signup flows land here with a threaded `callbackUrl`; stash it so finish
  // points can restore the original target after onboarding completes.
  useEffect(() => {
    stashOnboardingCallbackUrl(search);
  }, [search]);

  return (
    <Flexbox
      className={styles.outerContainer}
      height={'100%'}
      padding={isMobile ? 0 : 8}
      width={'100%'}
    >
      <Flexbox
        height={'100%'}
        width={'100%'}
        className={cx(
          isMobile
            ? styles.innerContainerMobile
            : isDarkMode
              ? styles.innerContainerDark
              : styles.innerContainerLight,
        )}
      >
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          justify={'space-between'}
          padding={isMobile ? 12 : 16}
          width={'100%'}
        >
          <ProductLogo color={theme.colorText} size={28} type={'text'} />
          <Flexbox horizontal align={'center'} gap={16}>
            <Flexbox horizontal align={'center'}>
              <LangButton placement={'bottomRight'} size={18} />
              <Divider className={styles.divider} orientation={'vertical'} />
              <ThemeButton placement={'bottomRight'} size={18} />
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <Center height={'100%'} width={'100%'}>
          {children}
        </Center>
      </Flexbox>
    </Flexbox>
  );
};

export default OnBoardingContainer;
