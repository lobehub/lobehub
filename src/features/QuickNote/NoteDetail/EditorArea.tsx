'use client';

import { Editor, useEditor } from '@lobehub/editor/react';
import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { FileTextIcon, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { getQuickNoteStoreState, quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';

import { resolveNoteEditorContent } from '../utils';
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
            onTextChange={(currentEditor) =>
              updateNoteContent(noteId, String(currentEditor.getDocument('markdown') ?? ''))
            }
          />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

EditorArea.displayName = 'QuickNoteEditorArea';

export default EditorArea;
