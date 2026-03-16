'use client';

import { useAnalytics } from '@lobehub/analytics/react';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { FlaskConical } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import ChangelogModal from '@/components/ChangelogModal';
import HighlightNotification from '@/components/HighlightNotification';
import LabsModal from '@/components/LabsModal';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import { useFeedbackModal } from '@/hooks/useFeedbackModal';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors/systemStatus';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';

const PRODUCT_HUNT_NOTIFICATION = {
  actionHref: 'https://www.producthunt.com/products/lobehub?launch=lobehub',
  endTime: new Date('2026-02-01T00:00:00Z'),
  image: 'https://hub-apac-1.lobeobjects.space/og/lobehub-ph.png',
  slug: 'product-hunt-2026',
  startTime: new Date('2026-01-27T08:00:00Z'),
};

const Footer = memo(() => {
  const { t } = useTranslation('common');
  const { analytics } = useAnalytics();
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const [shouldLoadChangelog, setShouldLoadChangelog] = useState(false);
  const [isChangelogModalOpen, setIsChangelogModalOpen] = useState(false);
  const [isProductHuntCardOpen, setIsProductHuntCardOpen] = useState(false);

  const [isNotificationRead, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.isNotificationRead(PRODUCT_HUNT_NOTIFICATION.slug)(s),
    s.updateSystemStatus,
  ]);

  const isWithinTimeWindow = useMemo(() => {
    const now = new Date();
    return now >= PRODUCT_HUNT_NOTIFICATION.startTime && now <= PRODUCT_HUNT_NOTIFICATION.endTime;
  }, []);

  const trackProductHuntEvent = useCallback(
    (eventName: string, properties: Record<string, string>) => {
      try {
        analytics?.track({ name: eventName, properties });
      } catch {
        // silently ignore tracking errors to avoid affecting business logic
      }
    },
    [analytics],
  );

  useEffect(() => {
    if (isWithinTimeWindow && !isNotificationRead) {
      setIsProductHuntCardOpen(true);
      trackProductHuntEvent('product_hunt_card_viewed', {
        spm: 'homepage.product_hunt.viewed',
        trigger: 'auto',
      });
    }
  }, [isWithinTimeWindow, isNotificationRead, trackProductHuntEvent]);

  const { open: openFeedbackModal } = useFeedbackModal();

  const handleOpenChangelogModal = () => {
    setShouldLoadChangelog(true);
    setIsChangelogModalOpen(true);
  };

  const handleCloseChangelogModal = () => {
    setIsChangelogModalOpen(false);
  };

  const handleOpenFeedbackModal = () => {
    openFeedbackModal();
  };

  const handleOpenProductHuntCard = () => {
    setIsProductHuntCardOpen(true);
    trackProductHuntEvent('product_hunt_card_viewed', {
      spm: 'homepage.product_hunt.viewed',
      trigger: 'menu_click',
    });
  };

  const handleCloseProductHuntCard = () => {
    setIsProductHuntCardOpen(false);
    if (!isNotificationRead) {
      const currentSlugs = useGlobalStore.getState().status.readNotificationSlugs || [];
      updateSystemStatus({
        readNotificationSlugs: [...currentSlugs, PRODUCT_HUNT_NOTIFICATION.slug],
      });
    }
    trackProductHuntEvent('product_hunt_card_closed', {
      spm: 'homepage.product_hunt.closed',
    });
  };

  const handleProductHuntActionClick = () => {
    trackProductHuntEvent('product_hunt_action_clicked', {
      spm: 'homepage.product_hunt.action_clicked',
    });
  };

  return (
    <>
      <Flexbox horizontal align={'center'} gap={2} justify={'space-between'} padding={8}>
        <Flexbox horizontal align={'center'} flex={1} gap={2}>
          {/* TODO: Help menu hidden for Loctek AI branding - restore if needed */}
          {isDevMode && (
            <Link to="/eval">
              <ActionIcon icon={FlaskConical} size={16} title="Evaluation Lab" />
            </Link>
          )}
        </Flexbox>
        <ThemeButton placement={'topCenter'} size={16} />
      </Flexbox>
      <ChangelogModal
        open={isChangelogModalOpen}
        shouldLoad={shouldLoadChangelog}
        onClose={handleCloseChangelogModal}
      />
      <HighlightNotification
        actionHref={PRODUCT_HUNT_NOTIFICATION.actionHref}
        actionLabel={t('productHunt.actionLabel')}
        description={t('productHunt.description')}
        image={PRODUCT_HUNT_NOTIFICATION.image}
        open={isProductHuntCardOpen}
        title={t('productHunt.title')}
        onActionClick={handleProductHuntActionClick}
        onClose={handleCloseProductHuntCard}
      />
    </>
  );
});

export default Footer;
