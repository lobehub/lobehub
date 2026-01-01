import { type EditLocalFileParams } from '@lobechat/electron-client-ipc';
import { type BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { useThemeMode } from 'antd-style';
import { createPatch } from 'diff';
import { ChevronRight } from 'lucide-react';
import path from 'path-browserify-esm';
import React, { memo, useMemo } from 'react';
import { Diff, Hunk, parseDiff } from 'react-diff-view';
import 'react-diff-view/style/index.css';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { LocalFile, LocalFolder } from '@/features/LocalFile';
import { localFileService } from '@/services/electron/localFileService';
import '@/styles/react-diff-view.dark.css';

const EditLocalFile = memo<BuiltinInterventionProps<EditLocalFileParams>>(({ args }) => {
  const { t } = useTranslation('tool');
  const { base, dir } = path.parse(args.file_path);

  // Fetch full file content
  const { data: fileData, isLoading } = useSWR(
    ['readLocalFile', args.file_path],
    () => localFileService.readLocalFile({ fullContent: true, path: args.file_path }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );

  const { isDarkMode } = useThemeMode();
  // Generate diff from full file content
  const files = useMemo(() => {
    if (!fileData?.content) return [];

    try {
      const oldContent = fileData.content;

      // Generate new content by applying the replacement
      const newContent = args.replace_all
        ? oldContent.replaceAll(args.old_string, args.new_string)
        : oldContent.replace(args.old_string, args.new_string);

      // Use createPatch to generate unified diff with full file content
      const patch = createPatch(args.file_path, oldContent, newContent, '', '');

      // Add git diff header for parseDiff compatibility
      const diffText = `diff --git a${args.file_path} b${args.file_path}\n${patch}`;

      return parseDiff(diffText);
    } catch (error) {
      console.error('Failed to generate diff:', error);
      return [];
    }
  }, [fileData?.content, args.file_path, args.old_string, args.new_string, args.replace_all]);

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal>
        <LocalFolder path={dir} />
        <Icon icon={ChevronRight} />
        <LocalFile name={base} path={args.file_path} />
      </Flexbox>

      {isLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : (
        <Flexbox gap={8}>
          <Text type="secondary">
            {args.replace_all
              ? t('localFiles.editFile.replaceAll')
              : t('localFiles.editFile.replaceFirst')}
          </Text>
          {files.map((file, index) => (
            <div key={`${file.oldPath}-${index}`} style={{ fontSize: '12px' }}>
              <Diff
                data-theme={isDarkMode ? 'dark' : 'light'}
                diffType={file.type}
                hunks={file.hunks}
                viewType="split"
              >
                {(hunks) => hunks.map((hunk) => <Hunk hunk={hunk} key={hunk.content} />)}
              </Diff>
            </div>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

EditLocalFile.displayName = 'EditLocalFileIntervention';

export default EditLocalFile;
