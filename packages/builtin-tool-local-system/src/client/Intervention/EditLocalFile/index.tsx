import type { EditLocalFileParams } from '@lobechat/electron-client-ipc';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { CodeDiff, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { Alert } from '@lobehub/ui/base-ui';
import { ChevronRight } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { LocalFile, LocalFolder } from '@/features/LocalFile';
import { localFileService } from '@/services/electron/localFileService';

import OutOfScopeWarning from '../OutOfScopeWarning';

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

  // Generate new content by applying the replacement.
  //
  // A single-occurrence edit whose old_string matches more than once is
  // refused by the runtime, so previewing `String.replace`'s first-match result
  // would show the user a concrete diff to approve that can never be applied.
  // Count the matches and say so instead.
  const { oldContent, newContent, matchCount } = useMemo(() => {
    if (!fileData?.content) return { matchCount: 0, newContent: '', oldContent: '' };

    const oldContent = fileData.content;
    const matchCount = args.old_string ? oldContent.split(args.old_string).length - 1 : 0;

    if (!args.replace_all && matchCount > 1) {
      return { matchCount, newContent: oldContent, oldContent };
    }

    const newContent = args.replace_all
      ? oldContent.replaceAll(args.old_string, args.new_string)
      : oldContent.replace(args.old_string, args.new_string);

    return { matchCount, newContent, oldContent };
  }, [fileData?.content, args.old_string, args.new_string, args.replace_all]);

  const isAmbiguous = !args.replace_all && matchCount > 1;

  return (
    <Flexbox gap={12}>
      <OutOfScopeWarning paths={[args.file_path]} />
      <Flexbox horizontal>
        <LocalFolder path={dir} />
        <Icon icon={ChevronRight} />
        <LocalFile name={base} path={args.file_path} />
      </Flexbox>

      {isLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : (
        <Flexbox gap={8}>
          {isAmbiguous ? (
            <Alert
              showIcon
              description={t('localFiles.editFile.ambiguous', { times: matchCount })}
              type="warning"
            />
          ) : (
            <>
              <Text type="secondary">
                {args.replace_all
                  ? t('localFiles.editFile.replaceAll')
                  : t('localFiles.editFile.replaceFirst')}
              </Text>
              {oldContent && (
                <CodeDiff
                  fileName={args.file_path}
                  newContent={newContent}
                  oldContent={oldContent}
                  showHeader={false}
                  variant="borderless"
                  viewMode="split"
                />
              )}
            </>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

EditLocalFile.displayName = 'EditLocalFileIntervention';

export default EditLocalFile;
