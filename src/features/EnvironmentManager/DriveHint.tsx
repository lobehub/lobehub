'use client';

import { Button, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { HardDriveIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/**
 * What the copy tabs say to an account without a drive: one line, and the way
 * to the storage page, where drives, their usage and the plan that includes
 * them are all set out. Not an upgrade pitch — an environment is a definition,
 * which this account can write and edit like anyone else; only the folders
 * initialized from it need a drive.
 */
const DriveHint = memo(() => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();

  return (
    <Flexbox horizontal align={'center'} gap={8} paddingBlock={12} wrap={'wrap'}>
      <Icon icon={HardDriveIcon} size={14} style={{ color: cssVar.colorTextTertiary }} />
      <Text fontSize={13} type={'secondary'}>
        {t('environments.instances.needsDrive')}
      </Text>
      <Button size={'small'} type={'link'} onClick={() => navigate('/settings/drive')}>
        {t('environments.instances.openDriveSettings')}
      </Button>
    </Flexbox>
  );
});

DriveHint.displayName = 'DriveHint';

export default DriveHint;
