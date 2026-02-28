import { Flexbox, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { type FC, type ReactNode } from 'react';

interface SettingHeaderProps {
  extra?: ReactNode;
  title: ReactNode;
}

const SettingHeader: FC<SettingHeaderProps> = ({ title, extra }) => {
  return (
    <Flexbox gap={24} style={{ paddingTop: 12 }}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Text strong fontSize={24}>
          {title}
        </Text>
        {extra}
      </Flexbox>
      <Divider style={{ margin: 0 }} />
    </Flexbox>
  );
};

export default SettingHeader;
