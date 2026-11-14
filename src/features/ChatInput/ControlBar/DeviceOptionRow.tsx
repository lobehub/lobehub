'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Button, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { RefreshCwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ExecutionTargetDeviceStatus, ExecutionTargetIcon } from '@/features/ExecutionTargetPicker';
import { isDevicePresenceUnknown } from '@/store/device';

import DeviceDetailPopover from './DeviceDetailPopover';
import { getDeviceOptionState } from './deviceOptionState';
import { handleDeviceRowKeyDown } from './deviceRowKeyDown';
import OptionRow from './OptionRow';

const styles = stylex.create({
  reconnectButton: { minHeight: '18px', paddingBlock: '0', paddingInline: '2px', fontSize: '11px' },
});

interface DeviceOptionRowProps {
  active: boolean;
  device: DeviceListItem;
  /** Replaces the machine name, e.g. "This computer" for this desktop's own row. */
  label?: string;
  onReconnect: () => void;
  onSelect: () => void;
  reconnecting: boolean;
  tags: ReactNode[];
}

/**
 * One device in the execution environment picker. Hovering it opens the
 * device's details beside the menu.
 */
const DeviceOptionRow = ({
  active,
  device,
  label,
  onReconnect,
  onSelect,
  reconnecting,
  tags,
}: DeviceOptionRowProps) => {
  const { t } = useTranslation('chat');
  // A row restored from the persisted list is neither online nor offline yet.
  const presenceUnknown = isDevicePresenceUnknown(device);
  const { offlineLabelKey, reconnectLabelKey, selectable, showReconnect } = getDeviceOptionState(
    device,
    { presenceUnknown },
  );

  return (
    <DeviceDetailPopover device={device}>
      <div
        data-testid={`device-option-${device.deviceId}`}
        onKeyDown={(event) => handleDeviceRowKeyDown(event, { disabled: !selectable, onSelect })}
      >
        <OptionRow
          active={active}
          disabled={!selectable}
          icon={<ExecutionTargetIcon devicePlatform={device.platform} target={'device'} />}
          label={label ?? (device.friendlyName || device.hostname || device.deviceId)}
          tags={tags}
          desc={
            <>
              <ExecutionTargetDeviceStatus
                offlineLabel={t(offlineLabelKey)}
                online={device.online}
                unknown={presenceUnknown}
                unknownLabel={t('heteroAgent.executionTarget.presenceChecking')}
                onlineLabel={t('heteroAgent.executionTarget.onlineConnections', {
                  count: device.channels.length,
                })}
              />
              {showReconnect ? (
                <Button
                  className={stylex.props(styles.reconnectButton).className}
                  icon={<Icon icon={RefreshCwIcon} size={10} />}
                  loading={reconnecting}
                  size={'small'}
                  type={'text'}
                  onClick={(event) => {
                    event.stopPropagation();
                    onReconnect();
                  }}
                >
                  {t(reconnectLabelKey)}
                </Button>
              ) : null}
            </>
          }
          onClick={onSelect}
        />
      </div>
    </DeviceDetailPopover>
  );
};

export default DeviceOptionRow;
