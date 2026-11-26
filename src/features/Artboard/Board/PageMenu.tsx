import { type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, ChevronsUpDownIcon, LayersIcon } from 'lucide-react';

import { sidebarRow } from '@/styles/density.stylex';

import { useBoard } from '../BoardContext';
import { artboardActions } from '../store';

const styles = stylex.create({
  switcher: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: sidebarRow.radius,
    display: 'flex',
    flexShrink: 1,
    gap: 8,
    height: sidebarRow.controlHeight,
    minWidth: 0,
    paddingInlineEnd: 8,
    paddingInlineStart: 10,
  },
  interactive: {
    backgroundColor: {
      ':hover': cssVar.colorFillTertiary,
      'default': 'transparent',
    },
    cursor: 'pointer',
  },
  title: {
    color: cssVar.colorText,
    fontSize: sidebarRow.textFontSize,
    fontWeight: 600,
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  page: {
    color: cssVar.colorTextSecondary,
    fontSize: 13,
    maxWidth: 160,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  icon: {
    flex: 'none',
  },
});

const PageMenu = ({ className }: { className?: string }) => {
  const board = useBoard();
  const current = board.pages.find((page) => page.id === board.pageId);
  const multiPage = board.pages.length > 1 && !!current;

  const label = (
    <>
      <Icon
        color={cssVar.colorTextTertiary}
        icon={LayersIcon}
        size={16}
        {...stylex.props(styles.icon)}
      />
      <span {...stylex.props(styles.title)}>{board.artboard.title}</span>
      {multiPage && <span {...stylex.props(styles.page)}>{current.name}</span>}
      {multiPage && (
        <Icon
          color={cssVar.colorTextTertiary}
          icon={ChevronsUpDownIcon}
          size={14}
          {...stylex.props(styles.icon)}
        />
      )}
    </>
  );

  const items: DropdownItem[] = multiPage
    ? board.pages.map((page) => ({
        icon: <Icon icon={CheckIcon} style={{ opacity: page.id === current.id ? 1 : 0 }} />,
        key: page.id,
        label: page.name,
        onClick: () => artboardActions.setPage(page.id),
      }))
    : [];

  return (
    <div className={className} style={{ display: 'flex', minWidth: 0 }}>
      {multiPage ? (
        <DropdownMenu items={items} placement="bottomLeft">
          <div {...stylex.props(styles.switcher, styles.interactive)}>{label}</div>
        </DropdownMenu>
      ) : (
        <div {...stylex.props(styles.switcher)}>{label}</div>
      )}
    </div>
  );
};

export default PageMenu;
