import type { DeviceScope } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button, Select, useModalContext } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { useSaveState } from '@/hooks/useSaveState';
import { devicePoolService } from '@/services/devicePool';

/** Selection and request state for the device-pool membership dialog. */
interface AddPoolDeviceProps {
  /** Registered devices owned by the caller, excluding existing memberships. */
  devices: { id: string; name: string | null; hostname: string | null }[];
  /** Refresh affected membership and pool caches after a successful write. */
  onAdded: () => Promise<void>;
  /** Target pool in the active scope. */
  poolId: string;
  /** Current resource scope. */
  scope: DeviceScope;
}

/**
 * Adds an owned device from a modal opened by either pool add affordance.
 *
 * Use when:
 * - The user clicks the heading plus or the empty-state Add Device button
 *
 * Expects:
 * - The dialog is hosted by the base-ui modal stack
 *
 * Returns:
 * - A device picker with pending feedback and retry on failure
 */
export function AddPoolDevice({ devices, onAdded, poolId, scope }: AddPoolDeviceProps) {
  const { t } = useTranslation('setting');
  const { close } = useModalContext();
  const [deviceId, setDeviceId] = useState('');
  const { save, status, retry } = useSaveState();
  const pending = status === 'saving';
  return (
    <Flexbox gap={16}>
      <Select
        disabled={pending}
        placeholder={t('devicePools.chooseDevice')}
        value={deviceId}
        options={devices.map((device) => ({
          value: device.id,
          label: device.name || device.hostname || device.id,
        }))}
        onChange={setDeviceId}
      />
      <Button
        disabled={!deviceId || pending}
        loading={pending}
        type="primary"
        onClick={() =>
          void save(async () => {
            await devicePoolService.addDevice({ id: poolId, deviceId, scope });
            await onAdded();
            close();
          })
        }
      >
        {t('devicePools.addDevice')}
      </Button>
      {status === 'failed' && <AutoSaveHint saveStatus={status} onRetry={retry} />}
    </Flexbox>
  );
}
