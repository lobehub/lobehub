// Fixture: a one-line error row with a small Retry in its trailing slot — a row button.
// Reduced from WorkingSidebar/Overview/DeviceStatusSection.
import { Flexbox, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { OverviewRow } from './OverviewRow';

const DeviceStatusSection = memo<{ onRetry: () => void }>(({ onRetry }) => {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');

  // A failed read is not a removed device: say so and offer a retry.
  return (
    <Flexbox>
      <OverviewRow
        danger
        icon={TriangleAlertIcon}
        iconColor={cssVar.colorError}
        value={t('workingPanel.overview.deviceError')}
        trailing={
          <Button icon={<Icon icon={RefreshCwIcon} size={12} />} size={'small'} onClick={onRetry}>
            {tCommon('retry')}
          </Button>
        }
      />
    </Flexbox>
  );
});

export default DeviceStatusSection;
