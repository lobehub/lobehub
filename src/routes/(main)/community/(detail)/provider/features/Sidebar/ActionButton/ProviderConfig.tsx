'use client';

import { isDesktop } from '@lobechat/const';
import { Button, Icon } from '@lobehub/ui';
import { SquareArrowOutUpRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SplitButton from '@/components/SplitButton';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { useDetailContext } from '../../DetailProvider';

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
    <SplitButton size={'large'} style={{ flex: 1, width: 'unset' }} type={'primary'}>
      <SplitButton.Main style={{ flex: 1 }} onClick={openSettings}>
        {t('providers.config')}
      </SplitButton.Main>
      <SplitButton.Menu items={items} popupProps={{ style: { minWidth: 267 } }} />
    </SplitButton>
  );
});

export default ProviderConfig;
