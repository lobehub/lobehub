'use client';

import { Button, Center, Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { cx, useTheme } from 'antd-style';
import { type FC, type PropsWithChildren, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { ProductLogo } from '@/components/Branding';
import LangButton from '@/features/User/UserPanel/LangButton';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import { useIsDark } from '@/hooks/useIsDark';
import { useUserStore } from '@/store/user';

import { styles } from './style';

const OnBoardingContainer: FC<PropsWithChildren> = ({ children }) => {
  const isDarkMode = useIsDark();
  const theme = useTheme();
  const { t } = useTranslation('onboarding');
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const finishOnboarding = useUserStore((s) => s.finishOnboarding);
  const isAgentOnboarding = pathname.startsWith('/onboarding/agent');

  const handleSkip = useCallback(() => {
    finishOnboarding();
    navigate('/');
  }, [finishOnboarding, navigate]);

  return (
    <Flexbox className={styles.outerContainer} height={'100%'} padding={8} width={'100%'}>
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
          <ProductLogo color={theme.colorText} size={28} type={'text'} />
          <Flexbox horizontal align={'center'} gap={16}>
            <Flexbox horizontal align={'center'}>
              <LangButton placement={'bottomRight'} size={18} />
              <Divider className={styles.divider} orientation={'vertical'} />
              <ThemeButton placement={'bottomRight'} size={18} />
            </Flexbox>
            {isAgentOnboarding ? (
              <Button size={'small'} type={'text'} onClick={handleSkip}>
                {t('agent.skipOnboarding')}
              </Button>
            ) : null}
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
