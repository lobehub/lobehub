'use client';

import { isSafeSandboxCwd } from '@lobechat/builtin-tool-cloud-sandbox';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { ActionIcon, Button, Input, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FolderOpenIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import type { SandboxInstance } from './useEnvironmentData';

const styles = createStaticStyles(({ css }) => ({
  /** The surface Railway gives the same job: a filled panel, set off from the list above it. */
  createCard: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
}));

interface InstanceListProps {
  /** Whether the create form is showing. Owned by the caller so the row's
   *  "new instance" action can open the fold straight into it. */
  adding: boolean;
  /**
   * Whether the caller owns the environment these belong to. A published
   * environment is one a colleague can run in, not one they can add copies to
   * or delete copies from, so the controls go away rather than fail.
   */
  editable: boolean;
  instances: SandboxInstance[];
  onAddingChange: (adding: boolean) => void;
  /** Open this instance's directory in the file browser. */
  onBrowse: (workingDirectory: string) => void;
  onCreate: (params: { name: string; workingDirectory: string }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Sizes are missing rather than zero when the sandbox could not be reached. */
  snapshotsUnavailable: boolean;
}

/**
 * The instances of one environment.
 *
 * Two of them is the supported way to run two conversations side by side: each
 * keeps its own folder and its own installed state, where a shared folder would
 * have them overwrite each other's work.
 */
const InstanceList = memo<InstanceListProps>(
  ({
    adding,
    editable,
    instances,
    onAddingChange,
    onBrowse,
    onCreate,
    onRemove,
    snapshotsUnavailable,
  }) => {
    const { t } = useTranslation('setting');

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
        onAddingChange(false);
      } finally {
        setBusy(false);
      }
    };

    return (
      <Flexbox gap={8}>
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
            {/* Reading what an instance kept is not an edit, so it stays
                available in an environment someone else published — that is
                most of what having access to one is for. */}
            <ActionIcon
              icon={FolderOpenIcon}
              size={'small'}
              title={t('environments.files.browse')}
              onClick={() => onBrowse(instance.workingDirectory)}
            />
            {editable && (
              <ActionIcon
                icon={Trash2Icon}
                size={'small'}
                title={t('environments.instances.remove')}
                // A rejected promise here used to disappear: the row stayed, and
                // a refused delete was indistinguishable from a click that did
                // nothing. The execution plane refuses while a conversation is
                // still using the instance, and that reason is the one worth
                // showing.
                onClick={() =>
                  onRemove(instance.id).catch((error: unknown) =>
                    toast.error(
                      (error as { message?: string })?.message ||
                        t('environments.instances.removeFailed'),
                    ),
                  )
                }
              />
            )}
          </Flexbox>
        ))}

        {snapshotsUnavailable && instances.length > 0 && (
          <Text fontSize={12} type={'secondary'}>
            {t('environments.instances.snapshotsUnavailable')}
          </Text>
        )}

        {!editable ? null : adding ? (
          /* A panel of its own rather than a row squeezed under the list: two
             fields and a button abreast left each of them too narrow to read,
             and the button was the one pushed out. Stacked full width with the
             actions underneath, the shape holds at any panel width — and the
             form now says how to leave it, which a bare row never did. */
          <Flexbox className={styles.createCard} gap={12}>
            <Text weight={500}>{t('environments.instances.add')}</Text>

            {/* Labelled, not just placeholded. Two bare boxes reading "副本名称"
                and "reports/q3" name neither field and vanish the moment
                anyone types, leaving a form nobody can check their own answer
                against. */}
            <Flexbox gap={6}>
              <Text fontSize={12} type={'secondary'} weight={500}>
                {t('environments.nameLabel')}
              </Text>
              <Input
                autoFocus
                placeholder={t('environments.instances.namePlaceholder')}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Flexbox>

            <Flexbox gap={6}>
              <Text fontSize={12} type={'secondary'} weight={500}>
                {t('environments.instances.directoryLabel')}
              </Text>
              {/* Beside the field it explains, rather than in the footer, where
                  it was squeezed into a column five lines tall next to buttons
                  that had room to spare. */}
              <Text fontSize={12} type={'secondary'}>
                {t('environments.instances.directoryHint')}
              </Text>
              <Input
                placeholder={t('environments.instances.directoryPlaceholder')}
                value={workingDirectory}
                onChange={(event) => setWorkingDirectory(event.target.value)}
              />
            </Flexbox>

            <Flexbox horizontal align={'center'} gap={12} justify={'flex-end'}>
              <Flexbox horizontal gap={8} style={{ flex: 'none' }}>
                <Button size={'small'} onClick={() => onAddingChange(false)}>
                  {t('environments.cancel')}
                </Button>
                <Button
                  disabled={!canCreate}
                  loading={busy}
                  size={'small'}
                  type={'primary'}
                  onClick={create}
                >
                  {t('environments.instances.confirm')}
                </Button>
              </Flexbox>
            </Flexbox>
          </Flexbox>
        ) : (
          <Flexbox horizontal>
            <Button
              icon={<Icon icon={PlusIcon} />}
              size={'small'}
              onClick={() => onAddingChange(true)}
            >
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
