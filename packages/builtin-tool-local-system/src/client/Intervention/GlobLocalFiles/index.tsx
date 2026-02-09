import  { type GlobFilesParams } from '@lobechat/electron-client-ipc';
import  { type BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import OutOfScopeWarning from '../OutOfScopeWarning';

const GlobLocalFiles = memo<BuiltinInterventionProps<GlobFilesParams>>(({ args }) => {
  const { t } = useTranslation('tool');
  const { pattern } = args;

  return (
    <Flexbox gap={12}>
      <OutOfScopeWarning paths={[pattern]} />
      <Flexbox gap={4}>
        <Text type="secondary">{t('localFiles.globFiles.pattern')}</Text>
        <Highlighter language="text" showLanguage={false} variant="outlined">
          {pattern}
        </Highlighter>
      </Flexbox>
    </Flexbox>
  );
});

GlobLocalFiles.displayName = 'GlobLocalFilesIntervention';

export default GlobLocalFiles;
