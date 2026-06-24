'use client';

import { isDesktop } from '@lobechat/const';
import { Button, DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon, SquareArrowOutUpRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { useDetailContext } from '../../DetailProvider';

const styles = createStaticStyles(({ css }) => ({
  // Joined split-button: main action + dropdown chevron, sharing a border like
  // antd's Dropdown.Button. Both <button>s are direct children because
  // DropdownMenu renders its trigger inline (Menu.Root is context-only).
  splitButton: css`
    & > button + button {
      margin-inline-start: -1px;
    }

    & > button:first-child {
      border-start-end-radius: 0;
      border-end-end-radius: 0;
    }

    & > button:last-child {
      border-start-start-radius: 0;
      border-end-start-radius: 0;
    }
  `,
}));

const ProviderConfig = memo(() => {
  const { t } = useTranslation('discover');
  const { url, modelsUrl, identifier } = useDetailContext();
  const navigate = useWorkspaceAwareNavigate();
  const openSettings = async () => {
    if (isDesktop) {
      const { ensureElectronIpc } = await import('@/utils/electron/ipc');
      await ensureElectronIpc().windows.openSettingsWindow({
        path: `/settings/provider/${identifier}`,
      });
      return;
    }
    navigate(`/settings/provider/${identifier}`);
  };

  const icon = <Icon icon={SquareArrowOutUpRight} size={16} />;

  const items = [
    url && {
      icon,
      key: 'officialSite',
      label: (
        <WorkspaceLink target={'_blank'} to={url}>
          {t('providers.officialSite')}
        </WorkspaceLink>
      ),
    },
    modelsUrl && {
      icon,
      key: 'modelSite',
      label: (
        <WorkspaceLink target={'_blank'} to={modelsUrl}>
          {t('providers.modelSite')}
        </WorkspaceLink>
      ),
    },
  ].filter(Boolean) as any;

  if (!items || items?.length === 0)
    return (
      <Button block size={'large'} style={{ flex: 1 }} type={'primary'}>
        {t('providers.config')}
      </Button>
    );

  return (
    <Flexbox horizontal className={styles.splitButton} style={{ flex: 1, width: 'unset' }}>
      <Button size={'large'} style={{ flex: 1 }} type={'primary'} onClick={openSettings}>
        {t('providers.config')}
      </Button>
      <DropdownMenu items={items} popupProps={{ style: { minWidth: 267 } }}>
        <Button icon={<Icon icon={ChevronDownIcon} />} size={'large'} type={'primary'} />
      </DropdownMenu>
    </Flexbox>
  );
});

export default ProviderConfig;
