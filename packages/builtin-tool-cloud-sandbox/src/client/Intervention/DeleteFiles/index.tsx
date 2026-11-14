'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Alert, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeleteFilesParams } from '../../../types';

/**
 * Approval for a permanent delete on the drive: every path, and — before the
 * user approves — that what goes cannot be brought back. The drive has no
 * trash, so this card is the last chance to say no.
 */
const DeleteFiles = memo<BuiltinInterventionProps<DeleteFilesParams>>(({ args }) => {
  const { t } = useTranslation('plugin');
  const paths = Array.isArray(args?.paths) ? [...new Set(args.paths)] : [];

  return (
    <Flexbox gap={8}>
      <Alert
        showIcon
        title={t('builtins.lobe-cloud-sandbox.deleteFiles.irreversible')}
        type={'error'}
        variant={'soft'}
      />
      <Text>{t('builtins.lobe-cloud-sandbox.deleteFiles.title', { count: paths.length })}</Text>
      <Flexbox gap={4}>
        {paths.map((path) => (
          <Text code ellipsis as={'span'} fontSize={12} key={path}>
            {path}
          </Text>
        ))}
      </Flexbox>
    </Flexbox>
  );
});

DeleteFiles.displayName = 'CloudSandboxDeleteFilesIntervention';

export default DeleteFiles;
