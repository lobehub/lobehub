'use client';

import { type EditLocalFileState } from '@lobechat/builtin-tool-local-system';
import { type EditLocalFileParams } from '@lobechat/electron-client-ipc';
import { type BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    font-family: ${cssVar.fontFamilyCode};
  `,
  root: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    color: ${cssVar.colorTextDescription};
  `,
}));

export const EditLocalFileInspector = memo<
  BuiltinInspectorProps<EditLocalFileParams, EditLocalFileState>
>(({ args, isLoading }) => {
  const { t } = useTranslation('plugin');

  // Show filename with parent directory for context
  let displayPath = '';
  if (args?.file_path) {
    const { base, dir } = path.parse(args.file_path);
    const parentDir = path.basename(dir);
    displayPath = parentDir ? `${parentDir}/${base}` : base;
  }

  return (
    <div className={cx(styles.root, isLoading && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-local-system.apiName.editLocalFile')}</span>
      {displayPath && (
        <>
          <Icon icon={ChevronRight} style={{ marginInline: 4 }} />
          <span className={styles.content}>{displayPath}</span>
        </>
      )}
    </div>
  );
});

EditLocalFileInspector.displayName = 'EditLocalFileInspector';
