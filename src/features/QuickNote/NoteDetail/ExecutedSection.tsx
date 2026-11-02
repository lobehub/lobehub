'use client';

import { cssVar, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { FileText, ListTodo, MessagesSquare, Target } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { QuickNoteProposal } from '@/services/quickNote';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

import {
  buildQuickNoteExecutedItems,
  type QuickNoteExecutedItem,
  type QuickNoteExecutedType,
} from './buildExecutedItems';
import SectionLabel from './SectionLabel';
import { styles } from './style';
import { useOpenQuickNoteTarget } from './useOpenQuickNoteTarget';

const TYPE_ICONS: Record<QuickNoteExecutedType, LucideIcon> = {
  goal: Target,
  page: FileText,
  task: ListTodo,
  topic: MessagesSquare,
};

const ExecutedRow = ({ item }: { item: QuickNoteExecutedItem }) => {
  const { t } = useTranslation(['note', 'chat']);
  const openTarget = useOpenQuickNoteTarget();
  const { target } = item;
  const trailing = item.status
    ? t(`taskDetail.status.${item.status}` as never, { defaultValue: item.status, ns: 'chat' })
    : t(`agentic.executed.type.${item.type}` as never, { ns: 'note' });

  const row = (
    <Flexbox
      horizontal
      align={'center'}
      gap={8}
      height={28}
      role={target ? 'button' : undefined}
      style={{ cursor: target ? 'pointer' : 'default' }}
      // `role="button"` alone leaves the row unreachable: it has to take focus and answer
      // Enter / Space the way a real button does.
      tabIndex={target ? 0 : undefined}
      onClick={target ? () => openTarget(target, item.title) : undefined}
      onKeyDown={
        target
          ? (event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              openTarget(target, item.title);
            }
          : undefined
      }
    >
      <Icon icon={TYPE_ICONS[item.type]} size={14} style={{ color: cssVar.colorTextSecondary }} />
      <Text ellipsis fontSize={13} style={{ flex: 1 }}>
        {item.title}
      </Text>
      <Text color={cssVar.colorTextTertiary} fontSize={11} style={{ flex: 'none' }}>
        {trailing}
      </Text>
    </Flexbox>
  );

  if (!target) return row;

  return (
    <Tooltip title={t('agentic.resources.openHint', { ns: 'note', title: item.title })}>
      {row}
    </Tooltip>
  );
};

/**
 * Objects the note produced: Tasks it started (applied Proposals and Dives) and other applied
 * Proposal results. These Tasks are hidden from task lists, so this is where they are found.
 */
const ExecutedSection = ({
  noteId,
  proposals,
}: {
  noteId: string;
  proposals: QuickNoteProposal[];
}) => {
  const { t } = useTranslation('note');
  const useFetchTasks = useQuickNoteStore((s) => s.useFetchTasks);
  const tasks = useQuickNoteStore(quickNoteSelectors.tasksById(noteId));
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  useFetchTasks(noteId);

  const items = buildQuickNoteExecutedItems(tasks, proposals, inboxAgentId);
  if (items.length === 0) return null;

  return (
    <Flexbox className={stylex.props(styles.section).className} gap={8}>
      <SectionLabel count={items.length} title={t('agentic.executed.title')} />
      {items.map((item) => (
        <ExecutedRow item={item} key={item.key} />
      ))}
    </Flexbox>
  );
};

export default ExecutedSection;
