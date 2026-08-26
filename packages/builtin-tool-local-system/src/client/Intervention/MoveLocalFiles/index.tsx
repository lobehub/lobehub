import type { MoveLocalFilesParams } from '@lobechat/electron-client-ipc';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import OutOfScopeWarning from '../OutOfScopeWarning';
import MoveFileItem from './MoveFileItem';

const MoveLocalFiles = memo<BuiltinInterventionProps<MoveLocalFilesParams>>(({ args }) => {
  const { items } = args;
  const { t } = useTranslation('tool');

  // Collect all paths (source and destination) for validation
  const allPaths = useMemo(() => items.flatMap((item) => [item.oldPath, item.newPath]), [items]);

  return (
    <Flexbox gap={8}>
      <OutOfScopeWarning paths={allPaths} />
      <Text type="secondary">{t('localFiles.moveFiles.itemsToMove', { count: items.length })}</Text>
      <Flexbox gap={6}>
        {items.map((item, index) => (
          <MoveFileItem key={index} newPath={item.newPath} oldPath={item.oldPath} />
        ))}
      </Flexbox>
    </Flexbox>
  );
});

export default MoveLocalFiles;
