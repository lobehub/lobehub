import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useActiveTabKey } from '@/hooks/useActiveTabKey';
import { useNavLayout } from '@/hooks/useNavLayout';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { isModifierClick } from '@/utils/navigation';

const BottomMenu = memo(() => {
  const tab = useActiveTabKey();
  const navigate = useNavigate();
  const { bottomMenuItems: items } = useNavLayout();
  const hiddenSections = useGlobalStore(systemStatusSelectors.hiddenSidebarSections);

  const visibleItems = items.filter((item) => !item.hidden && !hiddenSections.includes(item.key));

  if (visibleItems.length === 0) return null;

  return (
    <Flexbox
      gap={1}
      paddingBlock={4}
      style={{
        marginTop: 12,
        overflow: 'hidden',
      }}
    >
      {visibleItems.map((item) => (
        <Link
          key={item.key}
          to={item.url!}
          onClick={(e) => {
            if (isModifierClick(e)) return;
            e.preventDefault();
            navigate(item.url!);
          }}
        >
          <NavItem active={tab === item.key} icon={item.icon} title={item.title} />
        </Link>
      ))}
    </Flexbox>
  );
});

export default BottomMenu;
