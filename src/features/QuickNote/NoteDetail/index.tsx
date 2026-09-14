'use client';

import { Flexbox } from '@lobehub/ui';
import { lazy, memo, Suspense } from 'react';

import ContentLoading from '@/components/Loading/ContentLoading';
import RightPanel from '@/features/RightPanel';
import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import NotePlaceholder from '../NotePlaceholder';
import AnnotationPanel from './AnnotationPanel';
import EditorArea from './EditorArea';

const TopicChatDrawer = lazy(() => import('@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer'));

const NoteDetail = memo<{ id: string }>(({ id }) => {
  const notesInit = useQuickNoteStore((s) => s.notesInit);
  const exists = useQuickNoteStore((s) => Boolean(quickNoteSelectors.noteById(id)(s)));
  const [panelExpanded, toggleAnnotationPanel] = useQuickNoteStore((s) => [
    s.annotationPanelExpanded,
    s.toggleAnnotationPanel,
  ]);
  const topicDrawerOpen = useTaskStore(taskDetailSelectors.activeTopicDrawerTopicId);

  if (!notesInit) return <ContentLoading />;
  if (!exists) return <NotePlaceholder />;

  return (
    <Flexbox horizontal height={'100%'} width={'100%'}>
      <EditorArea noteId={id} />
      <RightPanel expand={panelExpanded} onExpandChange={toggleAnnotationPanel}>
        <AnnotationPanel noteId={id} />
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
