import { Alert, Flexbox, Icon } from '@lobehub/ui';
import { Blend, Cloud, LaptopMinimalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from '@/features/MCPPluginDetail/DetailProvider';

const icons = {
  hybrid: Blend,
  local: LaptopMinimalIcon,
  remote: Cloud,
};

const ConnectionTypeAlert = memo(() => {
  const { t } = useTranslation('discover');
  const { connectionType } = useDetailContext();

  if (!connectionType || !icons[connectionType]) return null;

  return (
    <Alert
      description={t(`mcp.details.connectionType.${connectionType}.desc`)}
      showIcon={false}
      title={
        <Flexbox horizontal align={'center'} gap={6}>
          <Icon icon={icons[connectionType]} size={20} />
          {t(`mcp.details.connectionType.${connectionType}.title`)}
        </Flexbox>
      }
    />
  );
});

export default ConnectionTypeAlert;
