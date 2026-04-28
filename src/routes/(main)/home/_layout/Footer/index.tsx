'use client';

import { SOCIAL_URL } from '@lobechat/business-const';
import { isDesktop } from '@lobechat/const';
import { useAnalytics } from '@lobehub/analytics/react';
import { type MenuProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { DiscordIcon, GithubIcon } from '@lobehub/ui/icons';
import {
  Book,
  CircleHelp,
  Feather,
  FileClockIcon,
  FlaskConical,
  MessageCircle,
  Rocket,
  Settings2,
  SettingsIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import ChangelogModal from '@/components/ChangelogModal';
import HighlightNotification from '@/components/HighlightNotification';
import { DOCUMENTS_REFER_URL, GITHUB } from '@/const/url';
import Billboard from '@/features/Billboard';
import { useBillboardMenuItems } from '@/features/Billboard/MenuItems';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import { useFeedbackModal } from '@/hooks/useFeedbackModal';
import { useNavLayout } from '@/hooks/useNavLayout';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors/systemStatus';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors/general';
import { prefetchRoute } from '@/utils/router';

import { resolveFooterPromotionState } from './promotionPipeline';

const AGENT_ONBOARDING_PROMO_SLUG = 'agent-onboarding-promo-v1';

const PRODUCT_HUNT_NOTIFICATION = {
  actionHref: 'https://www.producthunt.com/products/lobehub?launch=lobehub',
  endTime: new Date('2026-02-01T00:00:00Z'),
  image: 'https://hub-apac-1.lobeobjects.space/og/lobehub-ph.png',
  slug: 'product-hunt-2026',
  startTime: new Date('2026-01-27T08:00:00Z'),
} as const;

interface PromotionCard {
  actionHref?: string;
  actionIcon?: ReactNode;
  actionLabel: string;
  description: string;
  image?: string;
  onAction?: () => void;
  onActionClick?: () => void;
  onClose: () => void;
  title: string;
}

const Footer = memo(() => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { analytics } = useAnalytics();
  const { footer } = useNavLayout();
  const billboardMenuItems = useBillboardMenuItems();
  const enableAgentOnboarding = useServerConfigStore((s) => s.featureFlags.enableAgentOnboarding);
  const isMobile = useServerConfigStore((s) => !!s.isMobile);
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const [agentOnboardingFinished, agentOnboardingStarted, classicOnboardingFinished, isDevMode] =
    useUserStore((s) => [
      !!s.agentOnboarding?.finishedAt,
      !!s.agentOnboarding?.activeTopicId,
      !!s.onboarding?.finishedAt,
      userGeneralSettingsSelectors.config(s).isDevMode,
    ]);
  const [shouldLoadChangelog, setShouldLoadChangelog] = useState(false);
  const [isAgentOnboardingCardOpen, setIsAgentOnboardingCardOpen] = useState(false);
  const [isChangelogModalOpen, setIsChangelogModalOpen] = useState(false);
  const [isProductHuntCardOpen, setIsProductHuntCardOpen] = useState(false);

  const [isAgentOnboardingPromoRead, isProductHuntNotificationRead, updateSystemStatus] =
    useGlobalStore((s) => [
      systemStatusSelectors.isNotificationRead(AGENT_ONBOARDING_PROMO_SLUG)(s),
      systemStatusSelectors.isNotificationRead(PRODUCT_HUNT_NOTIFICATION.slug)(s),
      s.updateSystemStatus,
    ]);

  const isWithinTimeWindow = useMemo(() => {
    const now = new Date();
    return now >= PRODUCT_HUNT_NOTIFICATION.startTime && now <= PRODUCT_HUNT_NOTIFICATION.endTime;
  }, []);

  const {
    shouldAutoShowAgentOnboardingPromo,
    shouldAutoShowProductHuntCard,
    shouldShowProductHuntMenuEntry,
  } = useMemo(
    () =>
      resolveFooterPromotionState({
        agentOnboardingFinished,
        agentOnboardingStarted,
        classicOnboardingFinished,
        enableAgentOnboarding: !!enableAgentOnboarding,
        isAgentOnboardingPromoRead,
        isDesktop,
        isMobile,
        isProductHuntNotificationRead,
        isWithinProductHuntWindow: isWithinTimeWindow,
        serverConfigInit,
      }),
    [
      agentOnboardingFinished,
      agentOnboardingStarted,
      classicOnboardingFinished,
      enableAgentOnboarding,
      isAgentOnboardingPromoRead,
      isMobile,
      isProductHuntNotificationRead,
      isWithinTimeWindow,
      serverConfigInit,
    ],
  );

  const trackPromotionEvent = useCallback(
    (eventName: string, properties: Record<string, string>) => {
      try {
        analytics?.track({ name: eventName, properties });
      } catch {
        // silently ignore tracking errors to avoid affecting business logic
      }
    },
    [analytics],
  );

  const markNotificationRead = useCallback(
    (slug: string) => {
      const currentSlugs = useGlobalStore.getState().status.readNotificationSlugs || [];

      if (currentSlugs.includes(slug)) return;

      updateSystemStatus({ readNotificationSlugs: [...currentSlugs, slug] });
    },
    [updateSystemStatus],
  );

  useEffect(() => {
    if (!shouldAutoShowAgentOnboardingPromo) return;

    setIsAgentOnboardingCardOpen(true);
    trackPromotionEvent('agent_onboarding_promo_viewed', {
      spm: 'homepage.agent_onboarding_promo.viewed',
      trigger: 'auto',
    });
  }, [shouldAutoShowAgentOnboardingPromo, trackPromotionEvent]);

  useEffect(() => {
    if (!shouldAutoShowProductHuntCard) return;

    setIsProductHuntCardOpen(true);
    trackPromotionEvent('product_hunt_card_viewed', {
      spm: 'homepage.product_hunt.viewed',
      trigger: 'auto',
    });
  }, [isWithinTimeWindow, shouldAutoShowProductHuntCard, trackPromotionEvent]);

  const { open: openFeedbackModal } = useFeedbackModal();

  const handleOpenChangelogModal = () => {
    setShouldLoadChangelog(true);
    setIsChangelogModalOpen(true);
  };

  const handleCloseChangelogModal = () => {
    setIsChangelogModalOpen(false);
  };

  const handleOpenFeedbackModal = useCallback(() => {
    openFeedbackModal();
  }, [openFeedbackModal]);

  const handleCloseAgentOnboardingCard = useCallback(() => {
    setIsAgentOnboardingCardOpen(false);
    markNotificationRead(AGENT_ONBOARDING_PROMO_SLUG);
    trackPromotionEvent('agent_onboarding_promo_closed', {
      spm: 'homepage.agent_onboarding_promo.closed',
    });
  }, [markNotificationRead, trackPromotionEvent]);

  const handleAgentOnboardingAction = useCallback(() => {
    setIsAgentOnboardingCardOpen(false);
    markNotificationRead(AGENT_ONBOARDING_PROMO_SLUG);
    trackPromotionEvent('agent_onboarding_promo_clicked', {
      spm: 'homepage.agent_onboarding_promo.clicked',
    });
    navigate('/onboarding/agent');
  }, [markNotificationRead, navigate, trackPromotionEvent]);

  const handleOpenProductHuntCard = useCallback(() => {
    setIsProductHuntCardOpen(true);
    trackPromotionEvent('product_hunt_card_viewed', {
      spm: 'homepage.product_hunt.viewed',
      trigger: 'menu_click',
    });
  }, [trackPromotionEvent]);

  const handleCloseProductHuntCard = useCallback(() => {
    setIsProductHuntCardOpen(false);
    markNotificationRead(PRODUCT_HUNT_NOTIFICATION.slug);
    trackPromotionEvent('product_hunt_card_closed', {
      spm: 'homepage.product_hunt.closed',
    });
  }, [markNotificationRead, trackPromotionEvent]);

  const handleProductHuntActionClick = useCallback(() => {
    trackPromotionEvent('product_hunt_action_clicked', {
      spm: 'homepage.product_hunt.action_clicked',
    });
  }, [trackPromotionEvent]);

  const activePromotion = useMemo<PromotionCard | undefined>(() => {
    if (isAgentOnboardingCardOpen) {
      return {
        actionIcon: <Icon icon={MessageCircle} size={14} />,
        actionLabel: t('agentOnboardingPromo.actionLabel'),
        description: t('agentOnboardingPromo.description'),
        onAction: handleAgentOnboardingAction,
        onClose: handleCloseAgentOnboardingCard,
        title: t('agentOnboardingPromo.title'),
      };
    }

    if (isProductHuntCardOpen) {
      return {
        actionHref: PRODUCT_HUNT_NOTIFICATION.actionHref,
        actionLabel: t('productHunt.actionLabel'),
        description: t('productHunt.description'),
        image: PRODUCT_HUNT_NOTIFICATION.image,
        onActionClick: handleProductHuntActionClick,
        onClose: handleCloseProductHuntCard,
        title: t('productHunt.title'),
      };
    }

    return undefined;
  }, [
    handleAgentOnboardingAction,
    handleCloseAgentOnboardingCard,
    handleCloseProductHuntCard,
    handleProductHuntActionClick,
    isAgentOnboardingCardOpen,
    isProductHuntCardOpen,
    t,
  ]);

  const helpMenuItems: MenuProps['items'] = useMemo(
    () => [
      ...(footer.showSettingsEntry && !isDevMode
        ? [
            {
              icon: <Icon icon={Settings2} />,
              key: 'setting',
              label: <Link to="/settings">{t('userPanel.setting')}</Link>,
            },
            {
              type: 'divider' as const,
            },
          ]
        : []),
      {
        icon: <Icon icon={Book} />,
        key: 'docs',
        label: (
          <a href={DOCUMENTS_REFER_URL} rel="noopener noreferrer" target="_blank">
            {t('userPanel.docs')}
          </a>
        ),
      },
      {
        icon: <Icon icon={Feather} />,
        key: 'feedback',
        label: t('userPanel.feedback'),
        onClick: handleOpenFeedbackModal,
      },
      {
        icon: <Icon icon={DiscordIcon} />,
        key: 'discord',
        label: (
          <a href={SOCIAL_URL.discord} rel="noopener noreferrer" target="_blank">
            {t('userPanel.discord')}
          </a>
        ),
      },
      {
        type: 'divider',
      },
      {
        icon: <Icon icon={FileClockIcon} />,
        key: 'changelog',
        label: t('changelog'),
        onClick: handleOpenChangelogModal,
      },
      ...(footer.layout === 'compact' && !footer.hideGitHub
        ? [
            {
              icon: <Icon icon={GithubIcon} />,
              key: 'github',
              label: (
                <a href={GITHUB} rel="noopener noreferrer" target="_blank">
                  GitHub
                </a>
              ),
            },
          ]
        : []),
      ...(footer.showEvalEntry && footer.layout === 'compact'
        ? [
            {
              icon: <Icon icon={FlaskConical} />,
              key: 'eval',
              label: <Link to="/eval">Evaluation Lab</Link>,
            },
          ]
        : []),
      ...(shouldShowProductHuntMenuEntry
        ? [
            {
              icon: <Icon icon={Rocket} />,
              key: 'productHunt',
              label: 'Product Hunt',
              onClick: handleOpenProductHuntCard,
            },
          ]
        : []),
      ...(billboardMenuItems && billboardMenuItems.length > 0
        ? [{ type: 'divider' as const }, ...billboardMenuItems]
        : []),
    ],
    [
      footer.showSettingsEntry,
      footer.layout,
      footer.hideGitHub,
      footer.showEvalEntry,
      handleOpenFeedbackModal,
      handleOpenProductHuntCard,
      isDevMode,
      shouldShowProductHuntMenuEntry,
      t,
      billboardMenuItems,
    ],
  );

  return (
    <>
      {footer.layout === 'expanded' ? (
        <Flexbox horizontal align={'center'} gap={2} justify={'space-between'} padding={8}>
          <Flexbox horizontal align={'center'} flex={1} gap={2}>
            <DropdownMenu items={helpMenuItems} placement="topLeft">
              <ActionIcon
                aria-label={t('userPanel.help')}
                data-billboard-anchor=""
                icon={CircleHelp}
                size={16}
              />
            </DropdownMenu>
            {!footer.hideGitHub && (
              <a aria-label={'GitHub'} href={GITHUB} rel="noopener noreferrer" target={'_blank'}>
                <ActionIcon icon={GithubIcon} size={16} title={'GitHub'} />
              </a>
            )}
            <Link to="/eval">
              <ActionIcon icon={FlaskConical} size={16} title="Evaluation Lab" />
            </Link>
          </Flexbox>
          <ThemeButton placement={'topCenter'} size={16} />
        </Flexbox>
      ) : (
        <Flexbox horizontal align={'center'} gap={2} padding={8}>
          <DropdownMenu items={helpMenuItems} placement="topLeft">
            <ActionIcon aria-label={t('userPanel.help')} icon={CircleHelp} size={16} />
          </DropdownMenu>
          {isDevMode && (
            <Link to="/settings" onMouseEnter={() => prefetchRoute('/settings')}>
              <ActionIcon
                aria-label={t('userPanel.setting')}
                icon={SettingsIcon}
                size={16}
                title={t('userPanel.setting')}
              />
            </Link>
          )}
        </Flexbox>
      )}
      <ChangelogModal
        open={isChangelogModalOpen}
        shouldLoad={shouldLoadChangelog}
        onClose={handleCloseChangelogModal}
      />
      {activePromotion && (
        <HighlightNotification
          open
          actionHref={activePromotion.actionHref}
          actionIcon={activePromotion.actionIcon}
          actionLabel={activePromotion.actionLabel}
          description={activePromotion.description}
          image={activePromotion.image}
          title={activePromotion.title}
          onAction={activePromotion.onAction}
          onActionClick={activePromotion.onActionClick}
          onClose={activePromotion.onClose}
        />
      )}
      <Billboard />
    </>
  );
});

export default Footer;
