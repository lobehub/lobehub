'use client';

import { BRANDING_EMAIL, SOCIAL_URL } from '@lobechat/business-const';
import { ActionIcon, DropdownMenu, Icon, type MenuProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { DiscordIcon } from '@lobehub/ui/icons';
import {
  Book,
  CircleHelp,
  Feather,
  FileClockIcon,
  FlaskConical,
  Github,
  Mail,
  Rocket,
} from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ChangelogModal from '@/components/ChangelogModal';
import HighlightNotification from '@/components/HighlightNotification';
import LabsModal from '@/components/LabsModal';
import { DOCUMENTS_REFER_URL, GITHUB, mailTo } from '@/const/url';
import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import { useFeedbackModal } from '@/hooks/useFeedbackModal';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors/systemStatus';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const PRODUCT_HUNT_NOTIFICATION = {
  actionHref: 'https://www.producthunt.com/products/lobehub?launch=lobehub',
  endTime: new Date('2026-02-01T00:00:00Z'),
  image: 'https://hub-apac-1.lobeobjects.space/og/lobehub-ph.png',
  slug: 'product-hunt-2026',
  startTime: new Date('2026-01-27T08:00:00Z'),
};

const Footer = memo(() => {
  const { t } = useTranslation('common');
  const { hideGitHub } = useServerConfigStore(featureFlagsSelectors);
  const [isLabsModalOpen, setIsLabsModalOpen] = useState(false);
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

  useEffect(() => {
    if (isWithinTimeWindow && !isNotificationRead) {
      setIsProductHuntCardOpen(true);
    }
  }, [isWithinTimeWindow, isNotificationRead]);

  const { open: openFeedbackModal } = useFeedbackModal();

  const handleOpenLabsModal = () => {
    setIsLabsModalOpen(true);
  };

  const handleCloseLabsModal = () => {
    setIsLabsModalOpen(false);
  };

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
  };

  const handleCloseProductHuntCard = () => {
    setIsProductHuntCardOpen(false);
    if (!isNotificationRead) {
      const currentSlugs = useGlobalStore.getState().status.readNotificationSlugs || [];
      updateSystemStatus({
        readNotificationSlugs: [...currentSlugs, PRODUCT_HUNT_NOTIFICATION.slug],
      });
    }
  };

  const helpMenuItems: MenuProps['items'] = useMemo(
    () => [
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
        icon: <Icon icon={Mail} />,
        key: 'email',
        label: (
          <a href={mailTo(BRANDING_EMAIL.support)} rel="noopener noreferrer" target="_blank">
            {t('userPanel.email')}
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
      {
        icon: <Icon icon={FlaskConical} />,
        key: 'labs',
        label: t('labs'),
        onClick: handleOpenLabsModal,
      },
      ...(isWithinTimeWindow
        ? [
            {
              icon: <Icon icon={Rocket} />,
              key: 'productHunt',
              label: 'Product Hunt',
              onClick: handleOpenProductHuntCard,
            },
          ]
        : []),
    ],
    [t, isWithinTimeWindow],
  );

  return (
    <>
      <Flexbox align={'center'} gap={2} horizontal justify={'space-between'} padding={8}>
        <Flexbox align={'center'} flex={1} gap={2} horizontal>
          <DropdownMenu items={helpMenuItems} placement="topLeft">
            <ActionIcon aria-label={t('userPanel.help')} icon={CircleHelp} size={16} />
          </DropdownMenu>
          {!hideGitHub && (
            <a aria-label={'GitHub'} href={GITHUB} rel="noopener noreferrer" target={'_blank'}>
              <ActionIcon icon={Github} size={16} title={'GitHub'} />
            </a>
          )}
        </Flexbox>
        <ThemeButton placement={'topCenter'} size={16} />
      </Flexbox>
      <LabsModal onClose={handleCloseLabsModal} open={isLabsModalOpen} />
      <ChangelogModal
        onClose={handleCloseChangelogModal}
        open={isChangelogModalOpen}
        shouldLoad={shouldLoadChangelog}
      />
      <HighlightNotification
        actionHref={PRODUCT_HUNT_NOTIFICATION.actionHref}
        actionLabel={t('productHunt.actionLabel')}
        description={t('productHunt.description')}
        image={PRODUCT_HUNT_NOTIFICATION.image}
        onClose={handleCloseProductHuntCard}
        open={isProductHuntCardOpen}
        title={t('productHunt.title')}
      />
    </>
  );
});

export default Footer;
