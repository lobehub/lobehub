'use client';

import { AGENT_ONBOARDING_ENABLED } from '@lobechat/business-const';
import { isDesktop } from '@lobechat/const';
import { MAX_ONBOARDING_STEPS } from '@lobechat/types';
import { Center, Flexbox, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { cx, useTheme } from 'antd-style';
import { type FC, type MouseEvent, type PropsWithChildren, useCallback, useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { ProductLogo } from '@/components/Branding';
import LangButton from '@/features/User/UserPanel/LangButton';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useIsDark } from '@/hooks/useIsDark';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { stashOnboardingCallbackUrl } from '@/utils/onboardingRedirect';

import { styles } from './style';

const OnBoardingContainer: FC<PropsWithChildren> = ({ children }) => {
  const isDarkMode = useIsDark();
  const isMobile = useIsMobile();
  const theme = useTheme();
  const { t } = useTranslation('onboarding');
  const { pathname, search } = useLocation();
  const navigate = useWorkspaceAwareNavigate();

  // Signup flows land here with a threaded `callbackUrl`; stash it so finish
  // points can restore the original target after onboarding completes.
  useEffect(() => {
    stashOnboardingCallbackUrl(search);
  }, [search]);

  const setOnboardingStep = useUserStore((s) => s.setOnboardingStep);
  const enableAgentOnboarding = useServerConfigStore((s) => s.featureFlags.enableAgentOnboarding);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const isAgentOnboarding = pathname.startsWith('/onboarding/agent');
  const isBranchOnboarding = isAgentOnboarding || pathname.startsWith('/onboarding/classic');

  const showModeSwitchAndSkipFooter =
    AGENT_ONBOARDING_ENABLED &&
    !isDesktop &&
    serverConfigInit &&
    !!enableAgentOnboarding &&
    isBranchOnboarding;

  const handleSkip = useCallback(() => {
    void setOnboardingStep(MAX_ONBOARDING_STEPS);
    navigate('/onboarding/classic?entry=skip');
  }, [navigate, setOnboardingStep]);

  const switchMode = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      navigate(isAgentOnboarding ? '/onboarding/classic' : '/onboarding/agent');
    },
    [isAgentOnboarding, navigate],
  );

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
        {showModeSwitchAndSkipFooter && (
          <Center paddingBlock={isMobile ? '0 12px' : '0 8px'} paddingInline={16}>
            <Text fontSize={12} style={{ textAlign: 'center' }} type={'secondary'}>
              <Trans
                ns={'onboarding'}
                components={{
                  modeLink: (
                    <a
                      href={isAgentOnboarding ? '/onboarding/classic' : '/onboarding/agent'}
                      onClick={switchMode}
                    />
                  ),
                  modeText: <Text as={'span'} />,
                  skipLink: <Text as={'span'} style={{ cursor: 'pointer' }} onClick={handleSkip} />,
                  skipText: <Text as={'span'} style={{ cursor: 'pointer' }} />,
                }}
                i18nKey={
                  isAgentOnboarding
                    ? 'agent.layout.switchMessage'
                    : 'agent.layout.switchMessageClassic'
                }
                values={{
                  mode: isAgentOnboarding
                    ? t('agent.layout.mode.classic')
                    : t('agent.layout.mode.agent'),
                  skip: t('agent.layout.skip'),
                }}
              />
            </Text>
          </Center>
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default OnBoardingContainer;
