'use client';

import { type BuiltinRenderProps } from '@lobechat/types';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { File, Folder } from 'lucide-react';
import { memo } from 'react';

import { type SearchLocalFilesState } from '../../type';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    padding-inline: 8px 0;
  `,
  fileIcon: css`
    color: ${cssVar.colorTextSecondary};
  `,
  fileItem: css`
    cursor: default;
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: 4px;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  fileName: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
  folderIcon: css`
    color: ${cssVar.colorWarning};
  `,
  header: css`
    font-size: 12px;
  `,
  path: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface SearchLocalFilesParams {
  directory: string;
  fileType?: string;
  keyword?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
}

const SearchFiles = memo<BuiltinRenderProps<SearchLocalFilesParams, SearchLocalFilesState>>(
  ({ args, pluginState }) => {
    if (!pluginState?.results) {
      return null;
    }

    return (
      <Flexbox className={styles.container} gap={8}>
        {/* Header */}
        <Flexbox align={'center'} horizontal justify={'space-between'}>
          <Text className={styles.header}>
            🔍 Search in {args.directory}
            {args.keyword && ` for "${args.keyword}"`}
          </Text>
          <Text className={styles.path}>{pluginState.totalCount} results</Text>
        </Flexbox>

        {/* Results list */}
        {pluginState.results.length > 0 && (
          <Block padding={8} style={{ maxHeight: 300, overflow: 'auto' }} variant={'outlined'}>
            <Flexbox gap={2}>
              {pluginState.results.map((file, index) => (
                <Flexbox
                  align={'center'}
                  className={styles.fileItem}
                  horizontal
                  justify={'space-between'}
                  key={index}
                >
                  <Flexbox align={'center'} gap={8} horizontal>
                    {file.isDirectory ? (
                      <Folder className={styles.folderIcon} size={14} />
                    ) : (
                      <File className={styles.fileIcon} size={14} />
                    )}
                    <Flexbox gap={2}>
                      <Text className={styles.fileName}>{file.name}</Text>
                      <Text className={styles.path}>{file.path}</Text>
                    </Flexbox>
                  </Flexbox>
                </Flexbox>
              ))}
            </Flexbox>
          </Block>
        )}
      </Flexbox>
    );
  },
);

SearchFiles.displayName = 'SearchFiles';

export default SearchFiles;
