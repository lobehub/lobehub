import { Flexbox, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { type FC, type ReactNode } from 'react';

interface SettingHeaderProps {
  description?: ReactNode;
  extra?: ReactNode;
  title: ReactNode;
}

const SettingHeader: FC<SettingHeaderProps> = ({ title, description, extra }) => {
  return (
    <Flexbox gap={24} style={{ paddingTop: 12 }}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Flexbox gap={4}>
          <Text strong fontSize={24}>
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
