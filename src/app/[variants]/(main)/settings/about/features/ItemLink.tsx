import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type LucideIcon, SquareArrowOutUpRight } from 'lucide-react';
import { memo } from 'react';

export interface ItemLinkProps {
  href: string;
  icon?: LucideIcon;
  label: string;
  value: string;
}

const ItemLink = memo<ItemLinkProps>(({ label, href }) => {
  return (
    <a href={href} rel="noreferrer" style={{ color: 'inherit' }} target="_blank">
      <Flexbox align={'center'} gap={8} horizontal>
        {label}
        <Icon color={cssVar.colorTextDescription} icon={SquareArrowOutUpRight} size={14} />
      </Flexbox>
    </a>
  );
});

export default ItemLink;
