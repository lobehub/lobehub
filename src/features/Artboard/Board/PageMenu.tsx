import { type DropdownItem, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';

import { useBoard } from '../BoardContext';
import { artboardActions } from '../store';

const styles = stylex.create({
  trigger: {
    backgroundColor: {
      ':hover': cssVar.colorFillTertiary,
      'default': 'transparent',
    },
    borderRadius: cssVar.borderRadiusSM,
    color: cssVar.colorTextSecondary,
    cursor: 'pointer',
    flex: 'none',
    maxWidth: 160,
    paddingBlock: 2,
    paddingInline: 6,
  },
});

const PageMenu = () => {
  const board = useBoard();
  const current = board.pages.find((page) => page.id === board.pageId);
  if (board.pages.length < 2 || !current) return null;

  const items: DropdownItem[] = board.pages.map((page) => ({
    icon: <Icon icon={CheckIcon} style={{ opacity: page.id === current.id ? 1 : 0 }} />,
    key: page.id,
    label: page.name,
    onClick: () => artboardActions.setPage(page.id),
  }));

  return (
    <DropdownMenu items={items} placement="bottomLeft">
      <Flexbox horizontal align="center" gap={2} {...stylex.props(styles.trigger)}>
        <Text ellipsis style={{ color: 'inherit', fontSize: 12 }}>
          {current.name}
        </Text>
        <Icon icon={ChevronDownIcon} size={12} />
      </Flexbox>
    </DropdownMenu>
  );
};

export default PageMenu;
