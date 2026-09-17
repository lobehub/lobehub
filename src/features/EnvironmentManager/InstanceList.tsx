'use client';

import { isSafeSandboxCwd } from '@lobechat/builtin-tool-cloud-sandbox';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { ActionIcon, Button, Input, Tag, Text } from '@lobehub/ui/base-ui';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import type { SandboxInstance } from './useEnvironmentData';

interface InstanceListProps {
  instances: SandboxInstance[];
  onCreate: (params: { name: string; workingDirectory: string }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Sizes are missing rather than zero when the sandbox could not be reached. */
  snapshotsUnavailable: boolean;
}

/**
 * The working copies of one environment.
 *
 * Two of them is the supported way to run two conversations side by side: each
 * keeps its own folder and its own installed state, where a shared folder would
 * have them overwrite each other's work.
 */
const InstanceList = memo<InstanceListProps>(
  ({ instances, onCreate, onRemove, snapshotsUnavailable }) => {
    const { t } = useTranslation('setting');
    const [adding, setAdding] = useState(false);
    const [name, setName] = useState('');
    const [workingDirectory, setWorkingDirectory] = useState('');
    const [busy, setBusy] = useState(false);

    // Checked here against the rule the execution plane applies, so a folder it
    // would refuse is refused while the person is still typing rather than on
    // their next message.
    const canCreate = Boolean(name.trim()) && isSafeSandboxCwd(workingDirectory);

    const create = async () => {
      if (!canCreate) return;
      setBusy(true);
      try {
        await onCreate({ name: name.trim(), workingDirectory });
        setName('');
        setWorkingDirectory('');
        setAdding(false);
      } finally {
        setBusy(false);
      }
    };

    return (
      <Flexbox gap={8}>
        <Flexbox gap={2}>
          <Text fontSize={12} type={'secondary'} weight={500}>
            {t('environments.instances.title')}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {t('environments.instances.desc')}
          </Text>
        </Flexbox>

        {instances.length === 0 && !adding && (
          <Text fontSize={12} type={'secondary'}>
            {t('environments.instances.empty')}
          </Text>
        )}

        {instances.map((instance) => (
          <Flexbox horizontal align={'center'} gap={8} key={instance.id}>
            <Flexbox flex={1} gap={2}>
              <Flexbox horizontal align={'center'} gap={6}>
                <Text fontSize={13} weight={500}>
                  {instance.name}
                </Text>
                {instance.stale && (
                  <Tooltip title={t('environments.instances.staleHint')}>
                    <Tag color={'warning'} size={'small'}>
                      {t('environments.instances.stale')}
                    </Tag>
                  </Tooltip>
                )}
              </Flexbox>
              <Text fontSize={12} type={'secondary'}>
                {instance.workingDirectory}
              </Text>
            </Flexbox>
            <Text fontSize={12} type={'secondary'}>
              {/* An instance that was created but never used has no snapshot,
                  which is a normal state and not an error. */}
              {snapshotsUnavailable
                ? '—'
                : instance.snapshot
                  ? formatSize(instance.snapshot.bytes)
                  : t('environments.instances.unused')}
            </Text>
            <ActionIcon
              icon={Trash2Icon}
              size={'small'}
              title={t('environments.instances.remove')}
              onClick={() => onRemove(instance.id)}
            />
          </Flexbox>
        ))}

        {snapshotsUnavailable && instances.length > 0 && (
          <Text fontSize={12} type={'secondary'}>
            {t('environments.instances.snapshotsUnavailable')}
          </Text>
        )}

        {adding ? (
          <Flexbox gap={6}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Input
                placeholder={t('environments.instances.namePlaceholder')}
                style={{ flex: 1 }}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Input
                placeholder={t('environments.instances.directoryPlaceholder')}
                style={{ flex: 1 }}
                value={workingDirectory}
                onChange={(event) => setWorkingDirectory(event.target.value)}
              />
              <Button disabled={!canCreate} loading={busy} size={'small'} onClick={create}>
                {t('environments.instances.add')}
              </Button>
            </Flexbox>
            <Text fontSize={12} type={'secondary'}>
              {t('environments.instances.directoryHint')}
            </Text>
          </Flexbox>
        ) : (
          <Flexbox horizontal>
            <Button icon={<Icon icon={PlusIcon} />} size={'small'} onClick={() => setAdding(true)}>
              {t('environments.instances.add')}
            </Button>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

InstanceList.displayName = 'InstanceList';

export default InstanceList;
