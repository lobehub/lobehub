'use client';

import { Flexbox, Icon, Popover } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BoxIcon, PlusIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { sandboxWorkspaceService } from '@/services/sandboxWorkspace';

import { gitChipStyles } from './gitChipStyles';
import SandboxDirectoryPicker from './SandboxDirectoryPicker';

const styles = createStaticStyles(({ css }) => ({
  empty: css`
    padding-block: 12px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  row: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 8px;
    border-radius: 4px;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  selected: css`
    background: ${cssVar.colorFillSecondary};
  `,
}));

interface SandboxInstancePickerProps {
  onChange: (instanceId: string | undefined) => Promise<void>;
  /** Topic whose warm sandbox session serves the directory browser. */
  topicId: string;
  /** Currently chosen working copy. */
  value?: string;
}

/**
 * Which working copy this conversation runs in.
 *
 * A copy is a folder plus everything installed into it, so picking one is the
 * whole choice — the packages follow the folder, which is why two conversations
 * that must not overwrite each other take two copies rather than two folders
 * under one.
 *
 * Names, not sizes: sizes live in the snapshot store, which needs a live sandbox
 * session to answer, and a picker that takes seconds to open is a picker people
 * stop opening. The settings page is where sizes are worth the wait.
 */
const SandboxInstancePicker = memo<SandboxInstancePickerProps>(({ onChange, topicId, value }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);

  // Also fetched while CLOSED whenever a copy is bound, because the chip names
  // the copy by looking it up in this list: gating the list on `open` alone
  // leaves the closed chip with nothing to look up, so a topic that has chosen
  // a copy still reads "pick one" until the menu happens to be open.
  const { data, mutate } = useSWR(
    open || value ? ['sandbox-instances', topicId] : null,
    () => sandboxWorkspaceService.listInstances({ topicId, withSizes: false }),
    { revalidateOnFocus: false },
  );
  const { data: environmentData } = useSWR(open ? 'sandbox-environments' : null, () =>
    sandboxWorkspaceService.listEnvironments(),
  );

  const instances = data?.instances ?? [];
  const environmentNames = new Map(
    (environmentData?.environments ?? []).map((environment) => [environment.id, environment.name]),
  );
  const current = instances.find((instance) => instance.id === value);

  const select = async (instanceId: string | undefined) => {
    setOpen(false);
    await onChange(instanceId);
  };

  const createAt = async (path: string | undefined) => {
    if (!path) return;
    const created = await sandboxWorkspaceService.useInstanceAtDirectory({
      workingDirectory: path,
    });
    await mutate();
    await select(created.id);
  };

  return (
    <Popover
      arrow={false}
      open={open}
      placement={'topLeft'}
      trigger={'click'}
      content={
        <Flexbox gap={4} style={{ minWidth: 280 }}>
          {instances.length === 0 && (
            <Text className={styles.empty} fontSize={12}>
              {t('sandboxWorkspace.noInstances')}
            </Text>
          )}
          {instances.map((instance) => (
            <Flexbox
              className={`${styles.row} ${instance.id === value ? styles.selected : ''}`}
              key={instance.id}
              onClick={() => select(instance.id)}
            >
              <Flexbox flex={1} gap={2}>
                <Flexbox horizontal align={'center'} gap={6}>
                  <Text fontSize={13}>{instance.name}</Text>
                  {instance.stale && (
                    <Tag size={'small'}>{t('sandboxWorkspace.instanceStale')}</Tag>
                  )}
                </Flexbox>
                <Text fontSize={12} type={'secondary'}>
                  {environmentNames.get(instance.environmentId)} · {instance.workingDirectory}
                </Text>
              </Flexbox>
            </Flexbox>
          ))}

          {/* Browsing beats typing for picking a folder, so the existing
              directory browser opens on top of this menu rather than being
              replaced by a bare text field. */}
          <SandboxDirectoryPicker topicId={topicId} onChange={createAt}>
            <Flexbox horizontal align={'center'} className={styles.row} gap={6}>
              <Icon icon={PlusIcon} size={14} />
              <Text fontSize={13}>{t('sandboxWorkspace.newInstance')}</Text>
            </Flexbox>
          </SandboxDirectoryPicker>
        </Flexbox>
      }
      onOpenChange={setOpen}
    >
      <div className={gitChipStyles.prTrigger}>
        <Icon icon={BoxIcon} size={14} />
        <Text ellipsis style={{ maxWidth: 160 }}>
          {current?.name ?? t('sandboxWorkspace.selectInstance')}
        </Text>
      </div>
    </Popover>
  );
});

SandboxInstancePicker.displayName = 'SandboxInstancePicker';

export default SandboxInstancePicker;
