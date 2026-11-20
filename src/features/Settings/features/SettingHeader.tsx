import { Divider, Flexbox, Text } from '@lobehub/ui';
import { type FC, type ReactNode } from 'react';

import { useInterfaceDensity } from '@/styles/density';

interface SettingHeaderProps {
  description?: ReactNode;
  extra?: ReactNode;
  title: ReactNode;
}

const SettingHeader: FC<SettingHeaderProps> = ({ title, description, extra }) => {
  const compact = useInterfaceDensity() === 'compact';

  return (
    <Flexbox gap={compact ? 16 : 24} style={{ paddingTop: 12 }}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Flexbox gap={4}>
          <Text strong fontSize={compact ? 20 : 24}>
            {title}
          </Text>
          {description && <Text type={'secondary'}>{description}</Text>}
        </Flexbox>
        {extra}
      </Flexbox>
      <Divider style={{ margin: 0 }} />
    </Flexbox>
  );
};

export default SettingHeader;
