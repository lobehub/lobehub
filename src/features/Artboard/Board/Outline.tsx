import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useBoard } from '../BoardContext';
import { artboardActions, useArtboardStore } from '../store';
import { floatStyles } from '../Viewport/floatStyles';

const styles = stylex.create({
  divider: {
    backgroundColor: cssVar.colorBorderSecondary,
    flex: 'none',
    height: 1,
    marginBlock: 4,
    marginInline: -6,
  },
  label: {
    color: cssVar.colorTextTertiary,
    fontSize: 12,
    paddingBlockEnd: 4,
    paddingBlockStart: 6,
    paddingInline: 9,
  },
  group: {
    color: {
      ':hover': cssVar.colorText,
      'default': cssVar.colorTextSecondary,
    },
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    overflow: 'hidden',
    paddingBlock: 6,
    paddingInline: 9,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  item: {
    backgroundColor: {
      ':hover': cssVar.colorFillTertiary,
      'default': 'transparent',
    },
    borderRadius: 6,
    color: cssVar.colorTextSecondary,
    cursor: 'pointer',
    fontSize: 13,
    overflow: 'hidden',
    paddingBlock: 5,
    paddingInline: 9,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemActive: {
    backgroundColor: cssVar.colorFillSecondary,
    color: cssVar.colorText,
    fontWeight: 500,
  },
  panel: {
    insetBlockStart: 10,
    insetInlineStart: 10,
    maxHeight: 'calc(100% - 76px)',
    overflowY: 'auto',
    padding: 6,
    width: 184,
  },
});

const pressable = (onActivate: () => void) => ({
  onClick: onActivate,
  onKeyDown: (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onActivate();
  },
  role: 'button',
  tabIndex: 0,
});

const Outline = () => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const selected = useArtboardStore((s) => s.selected);

  return (
    <Flexbox gap={1} {...stylex.props(floatStyles.float, styles.panel)}>
      {board.pages.length > 1 && (
        <>
          <div {...stylex.props(styles.label)}>{t('artboard.pages.title')}</div>
          {board.pages.map((page) => (
            <div
              key={page.id}
              {...stylex.props(styles.item, page.id === board.pageId && styles.itemActive)}
              {...pressable(() => artboardActions.setPage(page.id))}
            >
              {page.name}
            </div>
          ))}
          <div {...stylex.props(styles.divider)} />
        </>
      )}
      <div {...stylex.props(styles.label)}>{t('artboard.outline.title')}</div>
      {board.groups.map((group) => {
        const members = board.boards.filter((b) => b.groupId === group.id);
        if (!members.length) return null;
        return (
          <Flexbox gap={1} key={group.id}>
            <div
              {...stylex.props(styles.group)}
              {...pressable(() => artboardActions.focus({ id: group.id, kind: 'group' }))}
            >
              {group.title}
            </div>
            {members.map((member) => (
              <div
                key={member.id}
                {...stylex.props(styles.item, selected === member.id && styles.itemActive)}
                {...pressable(() => artboardActions.focusItem(member.id))}
              >
                {member.title}
              </div>
            ))}
          </Flexbox>
        );
      })}
    </Flexbox>
  );
};

export default Outline;
