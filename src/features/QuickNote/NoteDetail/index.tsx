'use client';

import { cssVar, Flexbox } from '@lobehub/ui';
import { lazy, memo, Suspense } from 'react';

import ContentLoading from '@/components/Loading/ContentLoading';
import RightPanel from '@/features/RightPanel';
import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import NotePlaceholder from '../NotePlaceholder';
import AiPanel from './AiPanel';
import EditorArea from './EditorArea';

const TopicChatDrawer = lazy(() => import('@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer'));

const NoteDetail = memo<{ id: string }>(({ id }) => {
  const notesInit = useQuickNoteStore((s) => s.notesInit);
  const exists = useQuickNoteStore((s) => Boolean(quickNoteSelectors.noteById(id)(s)));
  const [panelExpanded, toggleAiPanel] = useQuickNoteStore((s) => [
    s.aiPanelExpanded,
    s.toggleAiPanel,
  ]);
  const topicDrawerOpen = useTaskStore(taskDetailSelectors.activeTopicDrawerTopicId);
  const useFetchNote = useQuickNoteStore((s) => s.useFetchNote);
  // The list loads in pages, so a link can open a note that no loaded page contains.
  const { isLoading: noteLoading } = useFetchNote(notesInit && !exists ? id : undefined);

  if (!notesInit) return <ContentLoading />;
  if (!exists) return noteLoading ? <ContentLoading /> : <NotePlaceholder />;

  return (
    <Flexbox horizontal height={'100%'} width={'100%'}>
      <EditorArea noteId={id} />
      <RightPanel
        backgroundColor={cssVar.colorFillQuaternary}
        expand={panelExpanded}
        onExpandChange={toggleAiPanel}
      >
        <AiPanel noteId={id} />
      </RightPanel>
      {topicDrawerOpen && (
        <Suspense>
          <TopicChatDrawer />
        </Suspense>
      )}
    </Flexbox>
  );
});

NoteDetail.displayName = 'QuickNoteDetail';

export default NoteDetail;
