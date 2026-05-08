'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

interface SectionHeaderProps {
  actionLabel?: string;
  actionUrl?: string;
  icon: LucideIcon;
  title: string;
}

const SectionHeader = memo<SectionHeaderProps>(({ icon, title, actionLabel, actionUrl }) => {
  return (
    <Flexbox horizontal align={'center'} justify={'space-between'}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon color={cssVar.colorTextDescription} icon={icon} size={18} />
        <Text color={cssVar.colorTextSecondary}>{title}</Text>
      </Flexbox>
      {actionLabel && actionUrl && (
        <Link to={actionUrl} style={{ color: 'inherit', textDecoration: 'none' }}>
          <Text fontSize={12} type={'secondary'}>
            {actionLabel}
          </Text>
        </Link>
      )}
    </Flexbox>
  );
});

export default SectionHeader;
