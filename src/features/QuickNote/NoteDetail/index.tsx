'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import ContentLoading from '@/components/Loading/ContentLoading';
import RightPanel from '@/features/RightPanel';
import { quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

import NotePlaceholder from '../NotePlaceholder';
import AnnotationPanel from './AnnotationPanel';
import EditorArea from './EditorArea';

const NoteDetail = memo<{ id: string }>(({ id }) => {
  const notesInit = useQuickNoteStore((s) => s.notesInit);
  const exists = useQuickNoteStore((s) => Boolean(quickNoteSelectors.noteById(id)(s)));
  const [panelExpanded, toggleAnnotationPanel] = useQuickNoteStore((s) => [
    s.annotationPanelExpanded,
    s.toggleAnnotationPanel,
  ]);

  if (!notesInit) return <ContentLoading />;
  if (!exists) return <NotePlaceholder />;

  return (
    <Flexbox horizontal height={'100%'} width={'100%'}>
      <EditorArea noteId={id} />
      <RightPanel stableLayout expand={panelExpanded} onExpandChange={toggleAnnotationPanel}>
        <AnnotationPanel noteId={id} />
      </RightPanel>
    </Flexbox>
  );
});

NoteDetail.displayName = 'QuickNoteDetail';

export default NoteDetail;
