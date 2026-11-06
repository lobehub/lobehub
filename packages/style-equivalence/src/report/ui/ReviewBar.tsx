import { Button, Flexbox, Hotkey, Text, TextArea, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, Undo2 } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import type { ReviewView } from '../api';

const styles = stylex.create({
  bar: {
    backgroundColor: cssVar.colorBgContainer,
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    flex: 'none',
    paddingBlock: 12,
    paddingInline: 32,
  },
  trigger: { display: 'inline-flex' },
});

const ActionTooltip = ({
  blocked,
  children,
  hotkey,
  title,
}: {
  blocked: boolean;
  children: ReactNode;
  hotkey: string;
  title: string;
}) => (
  <Tooltip hotkey={hotkey} title={title}>
    <span
      aria-label={blocked ? title : undefined}
      tabIndex={blocked ? 0 : undefined}
      {...stylex.props(styles.trigger)}
    >
      {children}
    </span>
  </Tooltip>
);

const passBlocker = (item: ReviewView, note: string) => {
  if (!item.canPass)
    return item.state === 'waiting-agent' ? '等 agent 读完代码才能操作' : '这一项只能打回';
  if (item.category === 'difference' && !note.trim()) return '有差异的项要先写一句为什么没问题';
};

export const ReviewBar = ({
  busy,
  error,
  inputRef,
  item,
  note,
  onNote,
  onPass,
  onRework,
  position,
}: {
  busy?: 'pass' | 'rework';
  error?: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  item: ReviewView;
  note: string;
  onNote: (value: string) => void;
  onPass: () => void;
  onRework: () => void;
  position: string;
}) => {
  const passNeedsNote = item.category === 'difference';
  const waiting = item.state === 'waiting-agent';
  const blocker = passBlocker(item, note);
  return (
    <Flexbox gap={8} {...stylex.props(styles.bar)}>
      <Flexbox horizontal align="flex-end" gap={8}>
        <TextArea
          aria-label="打回原因"
          autoSize={{ maxRows: 4, minRows: 1 }}
          disabled={Boolean(busy)}
          ref={inputRef}
          style={{ flex: 1 }}
          value={note}
          placeholder={
            passNeedsNote
              ? '写一句：为什么不一样也没问题，或者哪里要改'
              : '打回原因（打回时必填），比如「在线时多了一圈灰边」'
          }
          onChange={(event) => onNote(event.target.value)}
        />
        <ActionTooltip
          blocked={waiting}
          hotkey="n"
          title={waiting ? '等 agent 读完代码才能操作' : '打回，原因必填'}
        >
          <Button
            danger
            disabled={Boolean(busy) || waiting}
            icon={Undo2}
            loading={busy === 'rework'}
            onClick={onRework}
          >
            打回
          </Button>
        </ActionTooltip>
        <ActionTooltip blocked={Boolean(blocker)} hotkey="y" title={blocker ?? '通过这一项'}>
          <Button
            disabled={Boolean(busy || blocker)}
            icon={Check}
            loading={busy === 'pass'}
            type="primary"
            onClick={onPass}
          >
            通过
          </Button>
        </ActionTooltip>
      </Flexbox>
      <Flexbox horizontal align="center" gap={12}>
        {error ? (
          <Text fontSize={12} type="danger">
            操作没有保存：{error}
          </Text>
        ) : (
          <Text fontSize={12} type="secondary">
            {position}
            {blocker ? ` · ${blocker}` : ''}
          </Text>
        )}
        <Flexbox flex={1} />
        <Flexbox horizontal align="center" gap={4}>
          <Hotkey compact keys="j" />
          <Hotkey compact keys="k" />
          <Text fontSize={12} type="secondary">
            上下条
          </Text>
        </Flexbox>
        <Flexbox horizontal align="center" gap={4}>
          <Hotkey compact keys="y" />
          <Text fontSize={12} type="secondary">
            通过
          </Text>
        </Flexbox>
        <Flexbox horizontal align="center" gap={4}>
          <Hotkey compact keys="n" />
          <Text fontSize={12} type="secondary">
            打回
          </Text>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};
