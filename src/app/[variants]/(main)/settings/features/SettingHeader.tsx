import { Flexbox, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { FC, ReactNode } from 'react';

interface SettingHeaderProps {
  extra?: ReactNode;
  title: ReactNode;
}

const SettingHeader: FC<SettingHeaderProps> = ({ title, extra }) => {
  return (
    <Flexbox gap={24} style={{ paddingTop: 12 }}>
      <Flexbox align={'center'} horizontal justify={'space-between'}>
        <Text fontSize={24} strong>
          {title}
        </Text>
        {extra}
      </Flexbox>
      <Divider style={{ margin: 0 }} />
    </Flexbox>
  );
};

export default SettingHeader;
