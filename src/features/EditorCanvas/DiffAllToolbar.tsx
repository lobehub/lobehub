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
  const [isEditInit, setEditInit] = useState<boolean>(!!editor.getLexicalEditor());

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

  // Listen to editor state changes to detect diff nodes
  useEffect(() => {
    if (!editor) return;

    const lexicalEditor = editor.getLexicalEditor();

    if (!lexicalEditor || !isEditInit) return;

    const checkForDiffNodes = () => {
      const editorState = lexicalEditor.getEditorState();
      editorState.read(() => {
        // Get all nodes and check if any is a diff node
        const nodeMap = editorState._nodeMap;
        let hasDiffs = false;
        nodeMap.forEach((node) => {
          if (node.getType() === 'diff') {
            hasDiffs = true;
          }
        });
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
      unregister();
    };
  }, [editor, isEditInit]);

  return hasPendingDiffs;
};

interface DiffAllToolbarProps {
  documentId: string;
  editor: IEditor;
}
const DiffAllToolbar = memo<DiffAllToolbarProps>(({ documentId }) => {
  const { t } = useTranslation('editor');
  const isDarkMode = useIsDark();
  const [editor, performSave, markDirty] = useDocumentStore((s) => [
    s.editor!,
    s.performSave,
    s.markDirty,
  ]);

  const hasPendingDiffs = useEditorHasPendingDiffs(editor);

  if (!hasPendingDiffs) return null;

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
              editor?.dispatchCommand(LITEXML_DIFFNODE_ALL_COMMAND, {
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
              editor?.dispatchCommand(LITEXML_DIFFNODE_ALL_COMMAND, {
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
