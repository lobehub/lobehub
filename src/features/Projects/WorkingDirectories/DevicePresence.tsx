import type { DeviceListItem } from '@lobechat/types';
import { cssVar } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

/**
 * Presence as a dot — green online, gray offline — with the word on hover. A
 * device restored from the persisted list (`onlineUnknown`) has not been
 * confirmed yet, so it shows no dot until `listDevices` answers.
 */
export const DevicePresence = ({ device }: { device?: DeviceListItem }) => {
  const { t } = useTranslation('project');
  if (device?.onlineUnknown) return null;
  const online = !!device?.online;
  const label = t(online ? 'settings.deviceOnline' : 'settings.deviceOffline');
  // A plain element with its own title: a tooltip trigger inside a sortable
  // row renders as a bordered button.
  return (
    <div
      aria-label={label}
      role="img"
      title={label}
      style={{
        background: online ? cssVar.colorSuccess : cssVar.colorTextQuaternary,
        borderRadius: '50%',
        flex: 'none',
        height: 8,
        width: 8,
      }}
    />
  );
};
