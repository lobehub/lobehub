'use client';

import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { useEditor } from '@lobehub/editor/react';
import { DropdownMenu, Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, confirmModal, Text, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { EllipsisIcon, PanelRightOpen, Trash } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EditorCanvas } from '@/features/EditorCanvas';
import ToggleLeftPanelButton, { isMacDesktop } from '@/features/NavPanel/ToggleLeftPanelButton';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { getQuickNoteStoreState, quickNoteSelectors, useQuickNoteStore } from '@/store/quickNote';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { formatNoteMeta } from '../utils';
import { styles } from './style';
import { useNoteContentSync } from './useNoteContentSync';

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
  const { t } = useTranslation(['note', 'common']);
  const navigate = useWorkspaceAwareNavigate();
  const editor = useEditor();
  const removeNote = useQuickNoteStore((s) => s.removeNote);
  const panelExpanded = useQuickNoteStore((s) => s.annotationPanelExpanded);
  const toggleAnnotationPanel = useQuickNoteStore((s) => s.toggleAnnotationPanel);
  const note = useQuickNoteStore(quickNoteSelectors.noteById(noteId));
  const showLeftPanel = useGlobalStore(systemStatusSelectors.showLeftPanel);
  const toggleRightPanelHotkey = useUserStore(
    settingsSelectors.getHotkeyById(HotkeyEnum.ToggleRightPanel),
  );

  const editorData = useMemo(() => {
    const currentNote = quickNoteSelectors.noteById(noteId)(getQuickNoteStoreState());
    return { content: currentNote?.content, editorData: currentNote?.editorData };
  }, [noteId]);

  const onContentChange = useNoteContentSync(noteId, editor);

  const menuItems = [
    {
      danger: true,
      icon: <Icon icon={Trash} />,
      key: 'delete',
      label: t('editor.deleteNote'),
      onClick: () =>
        confirmModal({
          cancelText: t('cancel', { ns: 'common' }),
          content: t('feed.deleteConfirm'),
          okButtonProps: { danger: true },
          okText: t('delete', { ns: 'common' }),
          onOk: async () => {
            try {
              await removeNote(noteId);
              navigate('/note');
            } catch {
              toast.error(t('agentic.actionFailed'));
            }
          },
        }),
    },
  ];

  if (!note) return null;

  return (
    <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden' }}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.columnHeader}
        height={44}
        justify={'space-between'}
        paddingInline={16}
      >
        <Flexbox horizontal align={'center'} gap={4}>
          {!showLeftPanel && !isMacDesktop && <ToggleLeftPanelButton />}
          <Text color={cssVar.colorTextTertiary} fontSize={12}>
            {formatNoteMeta(note)}
          </Text>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8}>
          <SaveIndicator />
          <DropdownMenu items={menuItems} nativeButton={false}>
            <ActionIcon icon={EllipsisIcon} size={'small'} />
          </DropdownMenu>
          {!panelExpanded && (
            <ActionIcon
              icon={PanelRightOpen}
              size={'small'}
              title={t('annotation.togglePanel')}
              tooltipProps={{ hotkey: toggleRightPanelHotkey }}
              onClick={() => toggleAnnotationPanel(true)}
            />
          )}
        </Flexbox>
      </Flexbox>
      <Flexbox flex={1} style={{ overflowY: 'auto' }}>
        <Flexbox className={styles.editorColumn} paddingBlock={24} paddingInline={24}>
          <EditorCanvas
            editor={editor}
            editorData={editorData}
            entityId={noteId}
            placeholder={t('editor.placeholder')}
            style={{ minHeight: 320 }}
            onContentChange={onContentChange}
            onInit={(initializedEditor) => initializedEditor.focus()}
          />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

EditorArea.displayName = 'QuickNoteEditorArea';

export default EditorArea;
