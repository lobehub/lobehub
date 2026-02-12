import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { BanIcon, CircleCheckBigIcon, CircleDashedIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';

import Title from '../../../app/[variants]/(main)/community/features/Title';

export interface ScoreItemProps {
  check: boolean;
  desc: ReactNode;
  key: string;
  required?: boolean;
  title: ReactNode;
}

const ScoreItem = memo<ScoreItemProps>(({ required, check, desc, title }) => {
  return (
    <Flexbox horizontal align={'center'} gap={16} paddingInline={16}>
      <Icon
        icon={check ? CircleCheckBigIcon : required ? BanIcon : CircleDashedIcon}
        size={24}
        color={
          check ? cssVar.colorSuccess : required ? cssVar.colorError : cssVar.colorTextQuaternary
        }
      />
      <Flexbox gap={4}>
        <Title level={3}>{title}</Title>
        <p style={{ color: cssVar.colorTextSecondary, margin: 0 }}>{desc}</p>
      </Flexbox>
    </Flexbox>
  );
});

export default ScoreItem;
