import { type EditLocalFileState } from '@lobechat/builtin-tool-local-system';
import { type EditLocalFileParams } from '@lobechat/electron-client-ipc';
import { type BuiltinRenderProps } from '@lobechat/types';
import { Alert, Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { ChevronRight } from 'lucide-react';
import { useTheme } from 'next-themes';
import path from 'path-browserify-esm';
import React, { memo, useMemo } from 'react';
import { Diff, Hunk, parseDiff } from 'react-diff-view';
import 'react-diff-view/style/index.css';

import { LocalFile, LocalFolder } from '@/features/LocalFile';
import '@/styles/react-diff-view.dark.css';

const EditLocalFile = memo<BuiltinRenderProps<EditLocalFileParams, EditLocalFileState>>(
  ({ args, pluginState, pluginError }) => {
    const { base, dir } = path.parse(args.file_path);

    // Parse diff for react-diff-view
    const files = useMemo(() => {
      const diffText = pluginState?.diffText;
      if (!diffText) return [];

      try {
        return parseDiff(diffText);
      } catch (error) {
        console.error('Failed to parse diff:', error);
        return [];
      }
    }, [pluginState?.diffText]);
    const { resolvedTheme } = useTheme();
    const isDarkMode = resolvedTheme === 'dark';

    if (!args) return <Skeleton active />;

    return (
      <Flexbox gap={12}>
        <Flexbox horizontal>
          <LocalFolder path={dir} />
          <Icon icon={ChevronRight} />
          <LocalFile name={base} path={args.file_path} />
        </Flexbox>
        {pluginError ? (
          <Alert
            description={pluginError.message || 'Unknown error occurred'}
            showIcon
            title="Edit Failed"
            type="error"
          />
        ) : (
          <Flexbox data-theme={isDarkMode ? 'dark' : 'light'} gap={12}>
            {files.map((file, index) => (
              <div key={`${file.oldPath}-${index}`} style={{ fontSize: '12px' }}>
                <Diff
                  diffType={file.type}
                  gutterType="default"
                  hunks={file.hunks}
                  viewType="unified"
                >
                  {(hunks) => hunks.map((hunk) => <Hunk hunk={hunk} key={hunk.content} />)}
                </Diff>
              </div>
            ))}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

EditLocalFile.displayName = 'EditLocalFile';

export default EditLocalFile;
