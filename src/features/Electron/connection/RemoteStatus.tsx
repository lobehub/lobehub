import { ActionIcon } from '@lobehub/ui';
import { Loader, Wifi, WifiOffIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';

interface SyncProps {
  onClick: () => void;
}
const RemoteStatus = memo<SyncProps>(({ onClick }) => {
  const { t } = useTranslation('electron');

  const [isIniting, isSyncActive, useRemoteServerConfig] = useElectronStore((s) => [
    !s.isInitRemoteServerConfig,
    electronSyncSelectors.isSyncActive(s),
    s.useDataSyncConfig,
  ]);

  // Use useSWR to fetch the remote server configuration
  useRemoteServerConfig();

  return (
    <ActionIcon
      icon={isIniting ? Loader : isSyncActive ? Wifi : WifiOffIcon}
      loading={isIniting}
      size="small"
      title={
        isIniting
          ? t('sync.isIniting')
          : isSyncActive
            ? t('sync.inCloud')
            : t('sync.inLocalStorage')
      }
      tooltipProps={{
        placement: 'bottomRight',
      }}
      onClick={onClick}
    />
  );
});

export default RemoteStatus;
