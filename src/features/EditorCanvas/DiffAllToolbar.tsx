'use client';

import { DiffAction, IEditor, LITEXML_DIFFNODE_ALL_COMMAND } from '@lobehub/editor';
import { Block, Icon } from '@lobehub/ui';
import { Button, Space } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';
import { useDocumentStore } from '@/store/document';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    position: absolute;
    z-index: 1000;
    inset-block-end: 24px;
    inset-inline-start: 50%;
    transform: translateX(-50%);
  `,
  toolbar: css`
    border-color: ${cssVar.colorFillSecondary};
    background: ${cssVar.colorBgElevated};
  `,
  toolbarDark: css`
    box-shadow:
      0 14px 28px -6px #0003,
      0 2px 4px -1px #0000001f;
  `,
  toolbarLight: css`
    box-shadow:
      0 14px 28px -6px #0000001a,
      0 2px 4px -1px #0000000f;
  `,
}));

const useIsEditorInit = (editor: IEditor) => {
  const [isEditInit, setEditInit] = useState<boolean>(!!editor?.getLexicalEditor());

  useEffect(() => {
    if (!editor) return;

    const onInit = () => {
      console.log('init: id', editor.getLexicalEditor()?._key);
      setEditInit(true);
    };
    editor.on('initialized', onInit);
    return () => {
      editor.off('initialized', onInit);
    };
  }, [editor]);

  return isEditInit;
};

const useEditorHasPendingDiffs = (editor: IEditor) => {
  const [hasPendingDiffs, setHasPendingDiffs] = useState(false);
  const isEditInit = useIsEditorInit(editor);

  // Debug: 打印 editor 变化
  const editorKey = editor?.getLexicalEditor()?._key;
  console.log('[useEditorHasPendingDiffs] editor changed', {
    editorKey,
    isEditInit,
    hasPendingDiffs,
  });

  // Listen to editor state changes to detect diff nodes
  useEffect(() => {
    if (!editor) return;

    const lexicalEditor = editor.getLexicalEditor();

    if (!lexicalEditor || !isEditInit) return;

    console.log('[useEditorHasPendingDiffs] registering listener for editor:', lexicalEditor._key);

    const checkForDiffNodes = () => {
      const editorState = lexicalEditor.getEditorState();
      editorState.read(() => {
        // Get all nodes and check if any is a diff node
        const nodeMap = editorState._nodeMap;
        let hasDiffs = false;
        let diffCount = 0;
        nodeMap.forEach((node) => {
          if (node.getType() === 'diff') {
            hasDiffs = true;
            diffCount++;
          }
        });
        if (hasDiffs !== hasPendingDiffs) {
          console.log('[useEditorHasPendingDiffs] diff status changed', {
            editorKey: lexicalEditor._key,
            hasDiffs,
            diffCount,
          });
        }
        setHasPendingDiffs(hasDiffs);
      });
    };

    // Check initially
    checkForDiffNodes();

    const unregister = lexicalEditor.registerUpdateListener(() => {
      checkForDiffNodes();
    });
    // Register update listener
    return () => {
      console.log('[useEditorHasPendingDiffs] unregistering listener for editor:', lexicalEditor._key);
      unregister();
    };
  }, [editor, isEditInit]);

  return hasPendingDiffs;
};

interface DiffAllToolbarProps {
  documentId: string;
  editor: IEditor;
}
const DiffAllToolbar = memo<DiffAllToolbarProps>(({ documentId, editor: propsEditor }) => {
  const { t } = useTranslation('editor');
  const isDarkMode = useIsDark();
  const [storeEditor, activeDocumentId, performSave, markDirty] = useDocumentStore((s) => [
    s.editor!,
    s.activeDocumentId,
    s.performSave,
    s.markDirty,
  ]);

  // Debug: 检查 editor 实例一致性
  const editorMismatch = propsEditor !== storeEditor;
  const docIdMismatch = documentId !== activeDocumentId;

  console.log('[DiffAllToolbar] render', {
    propsDocId: documentId,
    storeActiveDocId: activeDocumentId,
    docIdMismatch,
    propsEditorKey: propsEditor?.getLexicalEditor()?._key,
    storeEditorKey: storeEditor?.getLexicalEditor()?._key,
    editorMismatch,
  });

  const hasPendingDiffs = useEditorHasPendingDiffs(storeEditor);

  // Debug: 日志打印 diff 状态
  console.log('[DiffAllToolbar] hasPendingDiffs:', hasPendingDiffs, 'for docId:', documentId);

  if (!hasPendingDiffs) return null;

  // 警告：如果 documentId 与 activeDocumentId 不匹配，可能是 bug
  if (docIdMismatch) {
    console.warn('[DiffAllToolbar] WARNING: documentId mismatch!', {
      propsDocId: documentId,
      storeActiveDocId: activeDocumentId,
    });
  }

  const handleSave = async () => {
    markDirty(documentId);
    await performSave();
  };

  return (
    <div className={styles.container}>
      <Block
        className={cx(styles.toolbar, isDarkMode ? styles.toolbarDark : styles.toolbarLight)}
        gap={8}
        horizontal
        padding={4}
        shadow
        variant="outlined"
      >
        <Space>
          <Button
            onClick={async () => {
              storeEditor?.dispatchCommand(LITEXML_DIFFNODE_ALL_COMMAND, {
                action: DiffAction.Reject,
              });
              await handleSave();
            }}
            size={'small'}
            type="text"
          >
            <Icon icon={X} size={16} />
            {t('modifier.rejectAll')}
          </Button>
          <Button
            color={'default'}
            onClick={async () => {
              storeEditor?.dispatchCommand(LITEXML_DIFFNODE_ALL_COMMAND, {
                action: DiffAction.Accept,
              });
              await handleSave();
            }}
            size={'small'}
            variant="filled"
          >
            <Icon color={'green'} icon={Check} size={16} />
            {t('modifier.acceptAll')}
          </Button>
        </Space>
      </Block>
    </div>
  );
});

DiffAllToolbar.displayName = 'DiffAllToolbar';

export default DiffAllToolbar;
