import { Flexbox, Icon, Select, Text, Tooltip } from '@lobehub/ui';
import { MicIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { meetingActions, useMeetingStore } from '@/store/meeting';

const DEFAULT_DEVICE = '__default__';

/** Input picker; the choice applies to the next recording. */
const MicrophoneSelect = ({ disabled }: { disabled?: boolean }) => {
  const { t } = useTranslation('meeting');
  const devices = useMeetingStore((s) => s.devices);
  const selectedDeviceId = useMeetingStore((s) => s.selectedDeviceId);

  return (
    <Flexbox gap={6}>
      <Text fontSize={12} type={'secondary'} weight={500}>
        {t('recorder.mic.label')}
      </Text>
      <Tooltip title={disabled ? t('recorder.mic.locked') : undefined}>
        <div>
          <Select
            disabled={disabled}
            prefix={<Icon icon={MicIcon} size={14} />}
            style={{ width: '100%' }}
            value={selectedDeviceId ?? DEFAULT_DEVICE}
            options={[
              { label: t('recorder.mic.default'), value: DEFAULT_DEVICE },
              ...devices.map((device) => ({ label: device.label, value: device.deviceId })),
            ]}
            onChange={(value) =>
              meetingActions.selectDevice(value === DEFAULT_DEVICE ? undefined : (value as string))
            }
          />
        </div>
      </Tooltip>
    </Flexbox>
  );
};

export default MicrophoneSelect;
