import { Button, Flexbox, Progress, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import type { ReviewPayload } from '../api';
import { Chip } from './Chip';

const styles = stylex.create({
  bar: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgContainer,
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    columnGap: 16,
    display: 'flex',
    flex: 'none',
    flexWrap: 'wrap',
    paddingBlock: 10,
    paddingInline: 20,
    rowGap: 8,
  },
  progress: { width: 160 },
});

export const ReviewProgress = ({
  onOpenReworked,
  payload,
}: {
  onOpenReworked: () => void;
  payload: ReviewPayload;
}) => {
  const { counts } = payload;
  const open = counts.todo + counts.changed;
  const total = payload.items.length;
  const decided = counts.passed + counts.reworked;
  return (
    <div {...stylex.props(styles.bar)}>
      <Text ellipsis strong>
        {payload.pr
          ? `#${payload.pr.number} ${payload.pr.title}`
          : `${payload.run.base.slice(0, 7)}..${payload.run.head.slice(0, 7)}`}
      </Text>
      <Text type="secondary">
        工具已自动证明 {counts.proven} 条，剩 {total} 条要你看
      </Text>
      <Flexbox flex={1} />
      <Flexbox horizontal align="center" gap={8}>
        <Progress
          aria-label="复查进度"
          percent={total ? Math.round((decided / total) * 100) : 100}
          showInfo={false}
          size="small"
          {...stylex.props(styles.progress)}
        />
        <Text fontSize={12} type="secondary">
          {decided} / {total}
        </Text>
      </Flexbox>
      <Flexbox horizontal align="center" gap={6}>
        <Chip tone="ok">已通过 {counts.passed}</Chip>
        <Chip tone="bad">已打回 {counts.reworked}</Chip>
        <Chip tone="plain">待看 {open}</Chip>
        {counts['waiting-agent'] > 0 && <Chip tone="warn">等 agent {counts['waiting-agent']}</Chip>}
      </Flexbox>
      <Button size="small" onClick={onOpenReworked}>
        查看打回（{counts.reworked}）
      </Button>
    </div>
  );
};
