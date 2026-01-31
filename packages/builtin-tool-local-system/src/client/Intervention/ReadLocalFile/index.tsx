import type { LocalReadFileParams } from '@lobechat/electron-client-ipc';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { ChevronRight } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { LocalFile, LocalFolder } from '@/features/LocalFile';

import OutOfScopeWarning from '../OutOfScopeWarning';

const ReadLocalFile = memo<BuiltinInterventionProps<LocalReadFileParams>>(({ args }) => {
  const { t } = useTranslation('tool');
  const { base, dir } = path.parse(args.path || '');

  return (
    <Flexbox gap={12}>
      <OutOfScopeWarning paths={[args.path]} />
      <Flexbox horizontal>
        <LocalFolder path={dir} />
        <Icon icon={ChevronRight} />
        <LocalFile name={base} path={args.path} />
      </Flexbox>
      {args.loc && (
        <Text style={{ fontSize: 12 }} type="secondary">
          {t('localFiles.readFile.lineRange', { end: args.loc[1], start: args.loc[0] })}
        </Text>
      )}
    </Flexbox>
  );
});

ReadLocalFile.displayName = 'ReadLocalFileIntervention';

export default ReadLocalFile;
