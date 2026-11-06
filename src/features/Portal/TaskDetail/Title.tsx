import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useTaskStore } from '@/store/task';
import { oneLineEllipsis } from '@/styles';

const styles = stylex.create({
  identifier: {
    flexShrink: 0,
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

const Title = memo(() => {
  const taskId = useChatStore(chatPortalSelectors.taskDetailId);
  const detail = useTaskStore((s) =>
    taskId ? s.taskDetailMap[s.taskRefIndex?.[taskId] ?? taskId] : undefined,
  );
  const identifier = detail?.identifier ?? taskId;
  const name = detail?.name;

  return (
    // Hug the content so the shared `…` sits right after the name.
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      {identifier && <span {...stylex.props(styles.identifier)}>{identifier}</span>}
      {name && (
        <Text
          className={oneLineEllipsis}
          style={{ color: cssVar.colorText, flex: '0 1 auto', fontSize: 14, minWidth: 0 }}
        >
          {name}
        </Text>
      )}
    </Flexbox>
  );
});

export default Title;
