'use client';

import type { DeviceListItem, DeviceVisibility } from '@lobechat/types';
import { Button, createModal, Icon } from '@lobehub/ui';
import { t } from 'i18next';
import { DownloadIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getChannelKind } from '../channelKind';
import { useCanOperateDevice } from '../useCanEditDevice';
import CliBatchUpdateContent from './Content';

export const openCliBatchUpdateModal = (visibility: DeviceVisibility) =>
  createModal({
    content: <CliBatchUpdateContent visibility={visibility} />,
    footer: null,
    // The dialog carries the batch's progress; only an explicit close leaves it.
    maskClosable: false,
    title: t('devices.cliBatch.title', { ns: 'setting' }),
    width: 'min(92vw, 560px)',
  });

const runsCli = (device: DeviceListItem) =>
  !!device.metadata?.cliVersion ||
  (device.channels ?? []).some((channel) => getChannelKind(channel.channel) === 'cli');

/**
 * Toolbar entry for updating every CLI in one workspace tab. Shown once the
 * caller can operate at least one device there that runs `lh connect`; the
 * server applies the same per-device gate when it builds the plan.
 */
export const CliBatchUpdateButton = ({
  devices,
  visibility,
}: {
  devices: DeviceListItem[];
  visibility: DeviceVisibility;
}) => {
  const { t } = useTranslation('setting');
  const canOperate = useCanOperateDevice();
  if (!devices.some((device) => canOperate(device) && runsCli(device))) return null;

  return (
    <Button icon={<Icon icon={DownloadIcon} />} onClick={() => openCliBatchUpdateModal(visibility)}>
      {t('devices.cliBatch.action')}
    </Button>
  );
};
