'use client';

import {
  FilePathDisplay,
  getFileLanguage,
  getFileName,
  KindDot,
  LineStats,
} from '@lobechat/shared-tool-ui/components';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, PatchDiff, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type CodexFileChangeArgs,
  type CodexFileChangeState,
  getFileChangeData,
  getFileChangeKind,
  getFileChangeStats,
} from './utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  emptyState: css`
    padding: 4px;
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  list: css`
    gap: 2px;
    min-width: 0;
    padding-block: 2px;
    padding-inline: 4px;
  `,
  patch: css`
    overflow: hidden;
    padding-block-end: 8px;
    padding-inline-start: 16px;
  `,
  rowMain: css`
    display: flex;
    flex: 1;
    gap: 10px;
    align-items: center;

    min-width: 0;
  `,
  path: css`
    overflow: hidden;
    display: flex;
    align-items: center;
    min-width: 0;
  `,
  row: css`
    gap: 8px;
    align-items: center;

    min-height: 26px;
    padding-block: 3px;
    padding-inline: 0;
  `,
  unknownPath: css`
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const FileChangeRender = memo<BuiltinRenderProps<CodexFileChangeArgs, CodexFileChangeState>>(
  ({ args, pluginState }) => {
    const { t } = useTranslation('plugin');
    const stats = getFileChangeStats(args, pluginState);
    const data = getFileChangeData(args, pluginState);

    if (stats.total === 0) {
      return (
        <Text className={styles.emptyState}>
          {t('builtins.codex.fileChange.noChanges', { defaultValue: 'No file changes' })}
        </Text>
      );
    }

    return (
      <Flexbox className={styles.list}>
        {data.changes.map((change, index) => {
          const kind = getFileChangeKind(change.kind);
          const path = change.path || '';

          return (
            <Flexbox key={`${path}-${index}`}>
              <Flexbox horizontal className={styles.row}>
                <KindDot kind={kind} />
                <div className={styles.rowMain}>
                  <div className={styles.path}>
                    {path ? (
                      <FilePathDisplay filePath={path} />
                    ) : (
                      <Text className={styles.unknownPath}>
                        {t('builtins.codex.fileChange.unknownFile', {
                          defaultValue: 'Unknown file',
                        })}
                      </Text>
                    )}
                  </div>
                  <LineStats linesAdded={change.linesAdded} linesDeleted={change.linesDeleted} />
                </div>
              </Flexbox>
              {change.diffText && (
                <div className={styles.patch}>
                  <PatchDiff
                    fileName={getFileName(path)}
                    language={getFileLanguage(path)}
                    patch={change.diffText}
                    showHeader={false}
                    variant="borderless"
                    viewMode="unified"
                  />
                </div>
              )}
            </Flexbox>
          );
        })}
      </Flexbox>
    );
  },
);

FileChangeRender.displayName = 'CodexFileChangeRender';

export default FileChangeRender;
