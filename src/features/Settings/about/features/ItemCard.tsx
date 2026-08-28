import { Block, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import { memo } from 'react';

export interface ItemCardProps {
  href: string;
  icon?: LucideIcon;
  label: string;
  value: string;
}

const ItemCard = memo<ItemCardProps>(({ label, icon, href }) => {
  return (
    <a href={href} rel="noreferrer" style={{ color: 'inherit' }} target="_blank">
      <Block clickable horizontal gap={12} paddingBlock={12} paddingInline={18}>
        {icon && <Icon fill={cssVar.colorText} icon={icon} size={18} />}
        {label}
      </Block>
    </a>
  );
});

export default ItemCard;
