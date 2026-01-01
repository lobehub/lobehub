import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type LucideIcon, SquareArrowOutUpRight } from 'lucide-react';
import Link from 'next/link';
import { memo } from 'react';

export interface ItemLinkProps {
  href: string;
  icon?: LucideIcon;
  label: string;
  value: string;
}

const ItemLink = memo<ItemLinkProps>(({ label, href }) => {
  return (
    <Link href={href} style={{ color: 'inherit' }} target={'_blank'}>
      <Flexbox align={'center'} gap={8} horizontal>
        {label}
        <Icon color={cssVar.colorTextDescription} icon={SquareArrowOutUpRight} size={14} />
      </Flexbox>
    </Link>
  );
});

export default ItemLink;
