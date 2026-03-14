'use client';

import { type MenuProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import {
  CircleHelp,
  FileClockIcon,
  FlaskConical,
  Settings2,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import ChangelogModal from '@/components/ChangelogModal';
import { DOCUMENTS_REFER_URL } from '@/const/url';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';

const Footer = memo(() => {
  const { t } = useTranslation('common');
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const [shouldLoadChangelog, setShouldLoadChangelog] = useState(false);
  const [isChangelogModalOpen, setIsChangelogModalOpen] = useState(false);

  const handleOpenChangelogModal = () => {
    setShouldLoadChangelog(true);
    setIsChangelogModalOpen(true);
  };

  const handleCloseChangelogModal = () => {
    setIsChangelogModalOpen(false);
  };

  const helpMenuItems: MenuProps['items'] = useMemo(
    () => [
      {
        icon: <Icon icon={Settings2} />,
        key: 'setting',
        label: <Link to="/settings">{t('userPanel.setting')}</Link>,
      },
      {
        type: 'divider' as const,
      },
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
        type: 'divider',
      },
      {
        icon: <Icon icon={FileClockIcon} />,
        key: 'changelog',
        label: t('changelog'),
        onClick: handleOpenChangelogModal,
      },
      ...(isDevMode
        ? [
            {
              icon: <Icon icon={Settings2} />,
              key: 'eval',
              label: <Link to="/eval">Evaluation Lab</Link>,
            },
          ]
        : []),
    ],
    [t, isDevMode],
  );

  return (
    <>
      <Flexbox horizontal align={'center'} gap={2} padding={8}>
        <DropdownMenu items={helpMenuItems} placement="topLeft">
          <ActionIcon aria-label={t('userPanel.help')} icon={CircleHelp} size={16} />
        </DropdownMenu>
      </Flexbox>
      <ChangelogModal
        open={isChangelogModalOpen}
        shouldLoad={shouldLoadChangelog}
        onClose={handleCloseChangelogModal}
      />
    </>
  );
});

export default Footer;
