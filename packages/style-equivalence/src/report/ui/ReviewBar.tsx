import { Button, Flexbox, Hotkey, Text, TextArea, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, Undo2 } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import type { ReviewView } from '../api';
import { defaultReworkNote, hasRenderedDifference } from '../review';

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
  if (item.category === 'difference' && !note.trim())
    return '通过要先写一句为什么不一样也没问题，打回不用写';
};

const placeholderOf = (differs: boolean, passNeedsNote: boolean) => {
  if (!differs) return '打回原因（打回时必填），比如「在线时多了一圈灰边」';
  return passNeedsNote
    ? '原因可不填：打回时默认记下这处差异；通过时要写一句为什么不一样也没问题'
    : '原因可不填：打回时默认记下这处差异，也可以写你自己的原因';
};

const reworkTitleOf = (item: ReviewView, differs: boolean, note: string) => {
  if (item.state === 'waiting-agent') return '等 agent 读完代码才能操作';
  if (!differs) return '打回，原因必填';
  return note.trim() ? '打回，记下你写的原因' : `打回，默认记下：${defaultReworkNote(item)}`;
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
  const passNeedsNote = item.canPass && item.category === 'difference';
  const waiting = item.state === 'waiting-agent';
  const blocker = passBlocker(item, note);
  const differs = hasRenderedDifference(item);
  const hints = [
    blocker,
    !differs && !waiting && !note.trim() ? '打回要先写原因' : undefined,
  ].filter(Boolean);
  return (
    <Flexbox gap={8} {...stylex.props(styles.bar)}>
      <Flexbox horizontal align="flex-end" gap={8}>
        <TextArea
          aria-label="打回原因"
          autoSize={{ maxRows: 4, minRows: 1 }}
          disabled={Boolean(busy)}
          placeholder={placeholderOf(differs, passNeedsNote)}
          ref={inputRef}
          style={{ flex: 1 }}
          value={note}
          onChange={(event) => onNote(event.target.value)}
        />
        <ActionTooltip blocked={waiting} hotkey="n" title={reworkTitleOf(item, differs, note)}>
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
            {hints.map((hint) => ` · ${hint}`).join('')}
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
