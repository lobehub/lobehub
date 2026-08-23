'use client';

import type { IEditor } from '@lobehub/editor';
import { DiffAction, LITEXML_DIFFNODE_ALL_COMMAND, useHasDiffNode } from '@lobehub/editor';
import { Block, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Space } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Check, X } from 'lucide-react';
import { memo } from 'react';
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

interface DiffAllToolbarProps {
  documentId: string;
  editor?: IEditor;
}
const DiffAllToolbar = memo<DiffAllToolbarProps>(({ documentId, editor }) => {
  const { t } = useTranslation('editor');
  const isDarkMode = useIsDark();
  const [performSave, markDirty] = useDocumentStore((s) => [s.performSave, s.markDirty]);

  const { hasDiff: hasPendingDiffs } = useHasDiffNode(editor);

  if (!editor || !hasPendingDiffs) return null;

  const handleSave = async () => {
    markDirty(documentId);
    await performSave(documentId, undefined, { saveSource: 'manual' });
  };

  return (
    <div className={styles.container}>
      <Block
        horizontal
        shadow
        className={cx(styles.toolbar, isDarkMode ? styles.toolbarDark : styles.toolbarLight)}
        gap={8}
        padding={4}
        variant="outlined"
      >
        <Space>
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
        </Space>
      </Block>
    </div>
  );
});

DiffAllToolbar.displayName = 'DiffAllToolbar';

export default DiffAllToolbar;
