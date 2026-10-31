'use client';

import type { IEditor } from '@lobehub/editor';
import { DiffAction, LITEXML_DIFFNODE_ALL_COMMAND } from '@lobehub/editor';
import { Block, Button, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Check, X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';
import { useDocumentStore } from '@/store/document';

const styles = stylex.create({
  container: {
    position: 'absolute',
    zIndex: 1000,
    insetBlockEnd: '24px',
    insetInlineStart: '50%',
    transform: 'translateX(-50%)',
  },
  toolbar: {
    borderColor: cssVar.colorFillSecondary,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  toolbarDark: { boxShadow: '0 14px 28px -6px #0003,\n      0 2px 4px -1px #0000001f' },
  toolbarLight: { boxShadow: '0 14px 28px -6px #0000001a,\n      0 2px 4px -1px #0000000f' },
});

const useIsEditorInit = (editor?: IEditor) => {
  const [isEditInit, setEditInit] = useState<boolean>(!!editor?.getLexicalEditor());

  useEffect(() => {
    if (!editor) return;

    // The editor may have initialized between render and this effect
    // (the Editor canvas mounts earlier and emits 'initialized' synchronously),
    // so re-check before subscribing to avoid missing the event forever.
    if (editor.getLexicalEditor()) {
      setEditInit(true);
      return;
    }

    const onInit = () => {
      setEditInit(true);
    };
    editor.on('initialized', onInit);
    return () => {
      editor.off('initialized', onInit);
    };
  }, [editor]);

  return isEditInit;
};

const useEditorHasPendingDiffs = (editor?: IEditor) => {
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
  editor?: IEditor;
}
const DiffAllToolbar = memo<DiffAllToolbarProps>(({ documentId, editor }) => {
  const { t } = useTranslation('editor');
  const isDarkMode = useIsDark();
  const [saveVersion, markDirty] = useDocumentStore((s) => [s.saveVersion, s.markDirty]);

  const hasPendingDiffs = useEditorHasPendingDiffs(editor);

  if (!editor || !hasPendingDiffs) return null;

  const handleSave = async () => {
    markDirty(documentId);
    await saveVersion(documentId);
  };

  return (
    <div {...stylex.props(styles.container)}>
      <Block
        horizontal
        shadow
        gap={8}
        padding={4}
        variant="outlined"
        className={
          stylex.props(styles.toolbar, isDarkMode ? styles.toolbarDark : styles.toolbarLight)
            .className
        }
      >
        <Flexbox horizontal align={'center'} gap={8}>
          <Button
            size={'small'}
            type="text"
            onClick={async () => {
              editor.dispatchCommand(LITEXML_DIFFNODE_ALL_COMMAND, {
                action: DiffAction.Reject,
              });
              await handleSave();
            }}
          >
            <Icon icon={X} size={16} />
            {t('modifier.rejectAll')}
          </Button>
          <Button
            size={'small'}
            type="fill"
            onClick={async () => {
              editor.dispatchCommand(LITEXML_DIFFNODE_ALL_COMMAND, {
                action: DiffAction.Accept,
              });
              await handleSave();
            }}
          >
            <Icon color={'green'} icon={Check} size={16} />
            {t('modifier.acceptAll')}
          </Button>
        </Flexbox>
      </Block>
    </div>
  );
});

DiffAllToolbar.displayName = 'DiffAllToolbar';

export default DiffAllToolbar;
