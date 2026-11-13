import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { useBoard } from '../BoardContext';
import { floatStyles } from '../Canvas/Overlays';
import { artboardActions, useArtboardStore } from '../store';

const styles = stylex.create({
  group: {
    color: cssVar.colorTextSecondary,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    paddingBlock: 6,
    paddingInline: 8,
  },
  item: {
    backgroundColor: {
      ':hover': cssVar.colorFillTertiary,
      'default': 'transparent',
    },
    borderRadius: cssVar.borderRadius,
    cursor: 'pointer',
    fontSize: 13,
    overflow: 'hidden',
    paddingBlock: 5,
    paddingInline: 8,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemActive: {
    backgroundColor: cssVar.colorFillSecondary,
  },
  panel: {
    insetBlockStart: 12,
    insetInlineStart: 12,
    maxHeight: 'calc(100% - 80px)',
    overflowY: 'auto',
    width: 184,
  },
});

const Outline = () => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const selected = useArtboardStore((s) => s.selected);

  return (
    <Flexbox gap={2} {...stylex.props(floatStyles.float, styles.panel)}>
      <Text style={{ fontSize: 12, padding: '6px 8px 2px' }} type="secondary">
        {t('artboard.outline.title')}
      </Text>
      {board.groups.map((group) => {
        const members = board.boards.filter((b) => b.groupId === group.id);
        if (!members.length) return null;
        return (
          <Flexbox key={group.id}>
            <div
              {...stylex.props(styles.group)}
              onClick={() => artboardActions.focus({ id: group.id, kind: 'group' })}
            >
              {group.title}
            </div>
            {members.map((member) => (
              <div
                key={member.id}
                {...stylex.props(styles.item, selected === member.id && styles.itemActive)}
                onClick={() => artboardActions.focusItem(member.id)}
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
