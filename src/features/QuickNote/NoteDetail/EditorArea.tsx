'use client';

import { Editor, useEditor } from '@lobehub/editor/react';
import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Text, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { FileTextIcon, PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEditorDocumentChange } from '@/hooks/useEditorDocumentChange';
import {
  ANALYZE_SETTLE_DELAY,
  getQuickNoteStoreState,
  quickNoteSelectors,
  useQuickNoteStore,
} from '@/store/quickNote';

import { resolveNoteEditorContent } from '../utils';
import AnalyzeSettings from './AnalyzeSettings';
import { styles } from './style';

const SaveIndicator = memo(() => {
  const { t } = useTranslation('note');
  const saveStatus = useQuickNoteStore((s) => s.saveStatus);
  const retrySave = useQuickNoteStore((s) => s.retrySave);

  if (saveStatus === 'idle') return null;

  if (saveStatus === 'failed')
    return (
      <Text fontSize={12} style={{ cursor: 'pointer' }} type={'danger'} onClick={retrySave}>
        {t('editor.saveFailed')}
      </Text>
    );

  return (
    <Text color={cssVar.colorTextTertiary} fontSize={12}>
      {saveStatus === 'saving' ? t('editor.saving') : t('editor.autoSaved')}
    </Text>
  );
});

SaveIndicator.displayName = 'QuickNoteSaveIndicator';

const AnalyzeAction = ({ noteId }: { noteId: string }) => {
  const { t } = useTranslation('note');
  const note = useQuickNoteStore(quickNoteSelectors.noteById(noteId));
  const requesting = useQuickNoteStore(quickNoteSelectors.isAnalyzing(noteId));
  const analyzeNote = useQuickNoteStore((s) => s.analyzeNote);
  const [now, setNow] = useState(Date.now());

  const run = note?.run;
  const runActive = Boolean(run && ['pending', 'running'].includes(run.status));
  const dueAt = runActive ? undefined : note?.analyzeDueAt;

  useEffect(() => {
    if (!dueAt || dueAt <= Date.now()) return;

    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [dueAt]);

  if (!note) return null;

  const remaining = dueAt ? Math.max(0, dueAt - now) : 0;
  const scheduled = remaining > 0;
  const circumference = 2 * Math.PI * 12;
  const progress = Math.min(1, remaining / ANALYZE_SETTLE_DELAY);
  const status = run?.kind === 'analyze' ? run.status : undefined;
  const loading = requesting || status === 'pending' || status === 'running';
  const title =
    status === 'pending'
      ? t('editor.analyzePending')
      : status === 'running'
        ? t('editor.analyzeRunning')
        : status === 'failed'
          ? t('editor.analyzeFailed')
          : scheduled
            ? t('editor.analyzeScheduled', { seconds: Math.max(1, Math.ceil(remaining / 1000)) })
            : t('editor.analyze');

  return (
    <span className={styles.analyzeAction}>
      <ActionIcon
        aria-label={title}
        disabled={!note.content.trim() || runActive}
        icon={Sparkles}
        loading={loading}
        size={'small'}
        title={title}
        style={{
          color:
            status === 'failed'
              ? cssVar.colorError
              : status === 'pending'
                ? cssVar.colorWarning
                : status === 'running'
                  ? cssVar.colorInfo
                  : undefined,
        }}
        onClick={() => {
          void analyzeNote(noteId).catch(() => toast.error(t('agentic.actionFailed')));
        }}
      />
      {scheduled && (
        <svg
          aria-hidden
          className={styles.analyzeProgress}
          height={28}
          viewBox={'0 0 28 28'}
          width={28}
        >
          <circle
            cx={14}
            cy={14}
            fill={'none'}
            r={12}
            stroke={cssVar.colorPrimary}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            strokeLinecap={'round'}
            strokeWidth={1.5}
            style={{ transition: 'stroke-dashoffset 100ms linear' }}
          />
        </svg>
      )}
    </span>
  );
};

const EditorArea = memo<{ noteId: string }>(({ noteId }) => {
  const { t } = useTranslation('note');
  const editor = useEditor();
  const updateNoteContent = useQuickNoteStore((s) => s.updateNoteContent);
  const [panelExpanded, toggleAnnotationPanel] = useQuickNoteStore((s) => [
    s.annotationPanelExpanded,
    s.toggleAnnotationPanel,
  ]);

  const initial = useMemo(
    () =>
      resolveNoteEditorContent(
        quickNoteSelectors.noteById(noteId)(getQuickNoteStoreState())?.content ?? '',
      ),
    [noteId],
  );

  useEditorDocumentChange({
    documentKey: noteId,
    editor,
    onContentChange: (currentEditor) =>
      updateNoteContent(
        noteId,
        String(currentEditor.getDocument('markdown') ?? ''),
        (currentEditor.getDocument('json') ?? {}) as Record<string, unknown>,
      ),
  });

  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.sectionHeader}
        justify={'space-between'}
        paddingBlock={12}
        paddingInline={16}
      >
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon icon={FileTextIcon} size={'small'} />
          <Text weight={500}>{t('editor.title')}</Text>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8}>
          <SaveIndicator />
          <AnalyzeSettings />
          <AnalyzeAction noteId={noteId} />
          <ActionIcon
            active={panelExpanded}
            icon={panelExpanded ? PanelRightClose : PanelRightOpen}
            size={'small'}
            title={t('annotation.togglePanel')}
            onClick={() => toggleAnnotationPanel()}
          />
        </Flexbox>
      </Flexbox>
      <Flexbox flex={1} style={{ overflowY: 'auto' }}>
        <Flexbox className={styles.editorColumn} paddingBlock={24} paddingInline={24}>
          <Editor
            autoFocus
            content={initial.content}
            editor={editor}
            key={noteId}
            placeholder={t('editor.placeholder')}
            type={initial.type}
          />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

EditorArea.displayName = 'QuickNoteEditorArea';

export default EditorArea;
