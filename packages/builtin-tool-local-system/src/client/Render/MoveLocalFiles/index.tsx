import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MoveFileItem from './MoveFileItem';

interface MoveFilesArgs {
  items?: Array<{ newPath: string; oldPath: string }>;
  operations?: Array<{ destination: string; source: string }>;
}

const MoveLocalFiles = memo<BuiltinRenderProps<MoveFilesArgs>>(({ args }) => {
  const { t } = useTranslation('tool');

  // Support both IPC format (items) and ComputerRuntime format (operations)
  const moveItems = (args.items || args.operations || []).map((item: any) => ({
    newPath: item.newPath || item.destination || '',
    oldPath: item.oldPath || item.source || '',
  }));

  return (
    <Flexbox gap={8}>
      <Text type="secondary">
        {t('localFiles.moveFiles.itemsMoved', { count: moveItems.length })}
      </Text>
      <Flexbox gap={6}>
        {moveItems.map((item, index) => (
          <MoveFileItem key={index} newPath={item.newPath} oldPath={item.oldPath} />
        ))}
      </Flexbox>
    </Flexbox>
  );
});

export default MoveLocalFiles;
