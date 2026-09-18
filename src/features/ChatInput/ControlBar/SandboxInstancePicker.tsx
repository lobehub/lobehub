'use client';

import { Flexbox, Icon, Popover } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BoxIcon, FolderOpenIcon, PlusIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { sandboxWorkspaceService } from '@/services/sandboxWorkspace';
import { useChatStore } from '@/store/chat';

import { gitChipStyles } from './gitChipStyles';

const styles = createStaticStyles(({ css }) => ({
  empty: css`
    padding-block: 12px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  environment: css`
    padding-block: 6px 2px;
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  footer: css`
    padding-block-start: 4px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
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
  /** Topic whose warm sandbox session serves the workspace file panel. */
  topicId: string;
  /** Currently chosen environment instance. */
  value?: string;
}

/**
 * Which environment, and which instance of it, this conversation runs in.
 *
 * Environments come first because that is the choice with meaning: an
 * environment says what should be installed, an instance is one materialization
 * of it — a directory plus the state built into it. Two conversations that must
 * not overwrite each other take two instances of the same environment, which is
 * why instances are listed under their environment rather than beside it.
 *
 * An environment with no instance yet is not a dead end: creating one needs
 * nothing from the user that the environment does not already say, so the
 * "new instance" row asks for nothing and binds what it made.
 *
 * Names, not sizes: sizes live in the snapshot store, which needs a live sandbox
 * session to answer, and a picker that takes seconds to open is a picker people
 * stop opening. The settings page is where sizes are worth the wait.
 */
const SandboxInstancePicker = memo<SandboxInstancePickerProps>(({ onChange, topicId, value }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState<string | undefined>();
  const navigate = useWorkspaceAwareNavigate();
  const openSandboxWorkspace = useChatStore((s) => s.openSandboxWorkspace);

  // Also fetched while CLOSED whenever an instance is bound, because the chip
  // names it by looking it up in this list: gating the list on `open` alone
  // leaves the closed chip with nothing to look up, so a topic that has chosen
  // an instance still reads "pick one" until the menu happens to be open.
  const { data, mutate } = useSWR(
    open || value ? ['sandbox-instances', topicId] : null,
    () => sandboxWorkspaceService.listInstances({ topicId, withSizes: false }),
    { revalidateOnFocus: false },
  );
  const { data: environmentData } = useSWR(open || value ? 'sandbox-environments' : null, () =>
    sandboxWorkspaceService.listEnvironments(),
  );

  const instances = data?.instances ?? [];
  const environments = environmentData?.environments ?? [];
  const current = instances.find((instance) => instance.id === value);

  const select = async (instanceId: string | undefined) => {
    setOpen(false);
    await onChange(instanceId);
  };

  const createIn = async (environmentId: string) => {
    setCreating(environmentId);
    try {
      const created = await sandboxWorkspaceService.createInstanceForEnvironment({ environmentId });
      await mutate();
      await select(created.id);
    } finally {
      setCreating(undefined);
    }
  };

  return (
    <Popover
      arrow={false}
      open={open}
      placement={'topLeft'}
      trigger={'click'}
      content={
        <Flexbox gap={2} style={{ minWidth: 280 }}>
          {environments.length === 0 && (
            <Flexbox
              className={styles.row}
              onClick={() => {
                setOpen(false);
                navigate('/settings/environments');
              }}
            >
              <Text className={styles.empty} fontSize={12}>
                {t('sandboxWorkspace.noEnvironments')}
              </Text>
            </Flexbox>
          )}

          {environments.map((environment) => (
            <Flexbox gap={2} key={environment.id}>
              <Text ellipsis className={styles.environment}>
                {environment.name}
              </Text>

              {instances
                .filter((instance) => instance.environmentId === environment.id)
                .map((instance) => (
                  <Flexbox
                    horizontal
                    align={'center'}
                    className={`${styles.row} ${instance.id === value ? styles.selected : ''}`}
                    gap={6}
                    key={instance.id}
                    onClick={() => select(instance.id)}
                  >
                    <Text ellipsis fontSize={13} style={{ flex: 1 }}>
                      {instance.name}
                    </Text>
                    {instance.stale && (
                      <Tag size={'small'}>{t('sandboxWorkspace.instanceStale')}</Tag>
                    )}
                  </Flexbox>
                ))}

              <Flexbox
                horizontal
                align={'center'}
                className={styles.row}
                gap={6}
                onClick={() => {
                  if (!creating) void createIn(environment.id);
                }}
              >
                <Icon icon={PlusIcon} size={14} />
                <Text fontSize={13} type={'secondary'}>
                  {creating === environment.id
                    ? t('sandboxWorkspace.creatingInstance')
                    : t('sandboxWorkspace.newInstance')}
                </Text>
              </Flexbox>
            </Flexbox>
          ))}

          {/* The workspace file panel has no other way in. It is not part of
              choosing an instance, so it sits below the choice rather than
              inside it. */}
          <Flexbox className={styles.footer}>
            <Flexbox
              horizontal
              align={'center'}
              className={styles.row}
              gap={6}
              onClick={() => {
                openSandboxWorkspace();
                setOpen(false);
              }}
            >
              <Icon icon={FolderOpenIcon} size={14} />
              <Text fontSize={13} type={'secondary'}>
                {t('sandboxWorkspace.browseFiles')}
              </Text>
            </Flexbox>
          </Flexbox>
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
