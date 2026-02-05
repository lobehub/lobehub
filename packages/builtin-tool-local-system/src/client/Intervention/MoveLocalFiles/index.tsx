import type { MoveLocalFilesParams } from '@lobechat/electron-client-ipc';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MoveFileItem from './MoveFileItem';

const MoveLocalFiles = memo<BuiltinInterventionProps<MoveLocalFilesParams>>(({ args }) => {
  const { items } = args;
  const { t } = useTranslation('tool');

  return (
    <Flexbox gap={8}>
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
