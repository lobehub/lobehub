import { Alert, Block, Drawer, Empty, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Inbox } from 'lucide-react';

import type { ReviewPayload } from '../api';

const styles = stylex.create({
  reason: {
    borderInlineStartColor: cssVar.colorError,
    borderInlineStartStyle: 'solid',
    borderInlineStartWidth: 3,
    paddingInlineStart: 10,
  },
});

const timeOf = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'numeric',
  });

export const ReworkPanel = ({
  onClose,
  open,
  payload,
}: {
  onClose: () => void;
  open: boolean;
  payload: ReviewPayload;
}) => {
  const reworked = payload.items.filter((item) => item.state === 'reworked' && item.rework);
  return (
    <Drawer
      open={open}
      placement="right"
      title={`已打回 ${reworked.length} 项`}
      width={480}
      footer={
        reworked.length > 0 && (
          <Alert
            description="在终端对 agent 说「处理打回」。改完重跑后，这些项会标成「已修改」回到左侧队列，请你再看一眼。"
            title="下一步"
            type="info"
            variant="soft"
          />
        )
      }
      onClose={onClose}
    >
      {reworked.length === 0 ? (
        <Empty
          description="打回的项会列在这里，附上你写的原因。"
          icon={Inbox}
          title="现在没有打回的项"
        />
      ) : (
        <Flexbox gap={8}>
          {reworked.map((item) => (
            <Block gap={8} key={item.key} padding={12} variant="outlined">
              <Flexbox horizontal align="baseline" gap={8}>
                <Text strong>{item.title}</Text>
                <Text fontSize={12} type="secondary">
                  {item.file.split('/').pop()}
                </Text>
                <Flexbox flex={1} />
                <Text fontSize={12} type="secondary">
                  {timeOf(item.rework!.at)}
                </Text>
              </Flexbox>
              <Text {...stylex.props(styles.reason)}>{item.rework!.note}</Text>
            </Block>
          ))}
        </Flexbox>
      )}
    </Drawer>
  );
};
