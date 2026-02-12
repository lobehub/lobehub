import type { RenameLocalFileParams } from '@lobechat/electron-client-ipc';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { ArrowRight, ChevronRight } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo } from 'react';

import { LocalFile, LocalFolder } from '@/features/LocalFile';

import OutOfScopeWarning from '../OutOfScopeWarning';

const RenameLocalFile = memo<BuiltinInterventionProps<RenameLocalFileParams>>(({ args }) => {
  const { path: filePath, newName } = args;
  const { base, dir } = path.parse(filePath || '');

  return (
    <Flexbox gap={12}>
      <OutOfScopeWarning paths={[filePath]} />
      <Flexbox horizontal>
        <LocalFolder path={dir} />
        <Icon icon={ChevronRight} />
        <LocalFile name={base} path={filePath} />
      </Flexbox>
      <Flexbox align="center" gap={8} horizontal>
        <Text type="secondary">{base}</Text>
        <Icon icon={ArrowRight} />
        <Text>{newName}</Text>
      </Flexbox>
    </Flexbox>
  );
});

RenameLocalFile.displayName = 'RenameLocalFileIntervention';

export default RenameLocalFile;
