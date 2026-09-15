import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useTaskStore } from '@/store/task';
import { oneLineEllipsis } from '@/styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  identifier: css`
    flex-shrink: 0;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
}));

const Title = memo(() => {
  const taskId = useChatStore(chatPortalSelectors.taskDetailId);
  const detail = useTaskStore((s) => (taskId ? s.taskDetailMap[taskId] : undefined));
  const identifier = detail?.identifier ?? taskId;
  const name = detail?.name;

  return (
    <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
      {identifier && <span className={styles.identifier}>{identifier}</span>}
      {name && (
        <Text
          className={oneLineEllipsis}
          style={{ color: cssVar.colorText, flex: 1, fontSize: 14, minWidth: 0 }}
        >
          {name}
        </Text>
      )}
    </Flexbox>
  );
});

export default Title;
