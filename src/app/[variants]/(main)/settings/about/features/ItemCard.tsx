import { Block, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { memo } from 'react';

export interface ItemCardProps {
  href: string;
  icon?: LucideIcon;
  label: string;
  value: string;
}

const ItemCard = memo<ItemCardProps>(({ label, icon, href }) => {
  return (
    <Link href={href} style={{ color: 'inherit' }} target={'_blank'}>
      <Block clickable gap={12} horizontal paddingBlock={12} paddingInline={18}>
        {icon && <Icon fill={cssVar.colorText} icon={icon} size={18} />}
        {label}
      </Block>
    </Link>
  );
});

export default ItemCard;
