'use client';

import { Alert, Button, Text, toast } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { describeError } from './errorMessage';
import { type SandboxEnvironment, useEnvironmentActions, useInstances } from './useEnvironmentData';

interface RebuildNoticeProps {
  /** Only the environment's owner can add a copy to it. */
  editable: boolean;
  environment: SandboxEnvironment;
}

/**
 * A private environment whose directories are still on the workspace's public
 * drive, from before members had drives of their own.
 *
 * Every member can reach the public drive, and an environment directory's
 * home holds whatever credentials its sessions left there — so those
 * directories are hidden on it and no longer run in. Private environments now
 * keep their directories on the owner's personal drive; this says so, and
 * initializes a new copy there in one click.
 */
const RebuildNotice = memo<RebuildNoticeProps>(({ editable, environment }) => {
  const { t } = useTranslation('setting');
  const { data } = useInstances();
  const actions = useEnvironmentActions();
  const [rebuilding, setRebuilding] = useState(false);

  const legacy = (data?.instances ?? []).filter(
    (instance) => instance.environmentId === environment.id && instance.rebuildRequired,
  );
  if (legacy.length === 0) return null;

  const rebuild = async () => {
    setRebuilding(true);
    try {
      await actions.rebuildOnOwnDrive(environment.id);
      toast.success(t('environments.instances.rebuildPersonalStarted'));
    } catch (error) {
      toast.error(describeError(error, t, t('environments.instances.rebuildPersonalFailed')));
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <Alert
      showIcon
      style={{ marginBlockEnd: 12 }}
      type={'warning'}
      variant={'soft'}
      action={
        editable ? (
          <Button loading={rebuilding} size={'small'} onClick={rebuild}>
            {t('environments.instances.rebuildPersonal')}
          </Button>
        ) : undefined
      }
      title={
        <Text fontSize={13} weight={400}>
          {t('environments.instances.rebuildPersonalDesc', {
            count: legacy.length,
            names: legacy.map((instance) => instance.workingDirectory).join(', '),
          })}
        </Text>
      }
    />
  );
});

RebuildNotice.displayName = 'RebuildNotice';

export default RebuildNotice;
