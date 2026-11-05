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
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type CodexFileChangeArgs,
  type CodexFileChangeState,
  getFileChangeData,
  getFileChangeKind,
  getFileChangeStats,
} from './utils';

const styles = stylex.create({
  emptyState: { padding: '4px', fontSize: '13px', color: cssVar.colorTextTertiary },
  list: { gap: '2px', minWidth: '0', paddingBlock: '2px', paddingInline: '4px' },
  patch: { overflow: 'hidden', paddingBlockEnd: '8px', paddingInlineStart: '16px' },
  rowMain: { display: 'flex', flex: '1', gap: '10px', alignItems: 'center', minWidth: '0' },
  path: { overflow: 'hidden', display: 'flex', alignItems: 'center', minWidth: '0' },
  row: {
    gap: '8px',
    alignItems: 'center',
    minHeight: '26px',
    paddingBlock: '3px',
    paddingInline: '0',
  },
  unknownPath: { fontSize: '13px', color: cssVar.colorTextTertiary },
});

const FileChangeRender = memo<BuiltinRenderProps<CodexFileChangeArgs, CodexFileChangeState>>(
  ({ args, pluginState }) => {
    const { t } = useTranslation('plugin');
    const stats = getFileChangeStats(args, pluginState);
    const data = getFileChangeData(args, pluginState);

    if (stats.total === 0) {
      return (
        <Text className={stylex.props(styles.emptyState).className}>
          {t('builtins.codex.fileChange.noChanges', { defaultValue: 'No file changes' })}
        </Text>
      );
    }

    return (
      <Flexbox className={stylex.props(styles.list).className}>
        {data.changes.map((change, index) => {
          const kind = getFileChangeKind(change.kind);
          const path = change.path || '';

          return (
            <Flexbox key={`${path}-${index}`}>
              <Flexbox horizontal className={stylex.props(styles.row).className}>
                <KindDot kind={kind} />
                <div {...stylex.props(styles.rowMain)}>
                  <div {...stylex.props(styles.path)}>
                    {path ? (
                      <FilePathDisplay filePath={path} />
                    ) : (
                      <Text className={stylex.props(styles.unknownPath).className}>
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
                <div {...stylex.props(styles.patch)}>
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
