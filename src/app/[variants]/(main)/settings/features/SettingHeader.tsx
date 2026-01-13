import { Flexbox, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { FC, ReactNode } from 'react';

interface SettingHeaderProps {
  title: ReactNode;
}

const SettingHeader: FC<SettingHeaderProps> = ({ title }) => {
  return (
    <Flexbox gap={24} style={{ paddingTop: 12 }}>
      <Text fontSize={24} strong>
        {title}
      </Text>
      <Divider style={{ margin: 0 }} />
    </Flexbox>
  );
};

export default SettingHeader;
