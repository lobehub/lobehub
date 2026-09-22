'use client';

import { isSafeSandboxCwd } from '@lobechat/builtin-tool-cloud-sandbox';
import { Center, Empty, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { ActionIcon, Button, confirmModal, Input, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  CheckIcon,
  FolderOpenIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import { describeError } from './errorMessage';
import { openInstanceFileBrowser } from './InstanceFileBrowser';
import type { SandboxInstance } from './useEnvironmentData';

const styles = createStaticStyles(({ css }) => ({
  /**
   * One framed block with rules between its rows, rather than rows floating on
   * the panel. Loose rows read as a list of unrelated lines; a frame says where
   * the set begins and ends, which is what makes the "new instance" button
   * below it read as an addition to that set.
   */
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  row: css`
    padding-block: 12px;
    padding-inline: 16px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
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
  onCreate: (params: { name: string; workingDirectory: string }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Only the label: the folder holds the built state and cannot move. */
  onRename: (params: { id: string; name: string }) => Promise<void>;
  /** Sizes are still on their way from the execution plane. */
  snapshotsPending: boolean;
  /** Sizes are missing rather than zero when the sandbox could not be reached. */
  snapshotsUnavailable: boolean;
}

interface InstanceRowProps {
  editable: boolean;
  instance: SandboxInstance;
  onRemove: (id: string) => Promise<void>;
  onRename: (params: { id: string; name: string }) => Promise<void>;
  snapshotsPending: boolean;
  snapshotsUnavailable: boolean;
}

/**
 * One instance, either as it is or with its name open for editing.
 *
 * The name is the only thing that can change here. The folder is where the
 * built state lives, and the execution plane has no rename that carries one
 * folder to another, so editing shows it locked with the reason rather than
 * as a field that would fail on save.
 */
const InstanceRow = memo<InstanceRowProps>(
  ({ editable, instance, onRemove, onRename, snapshotsPending, snapshotsUnavailable }) => {
    const { t } = useTranslation('setting');

    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(instance.name);
    const [saving, setSaving] = useState(false);

    const startEditing = () => {
      setDraft(instance.name);
      setEditing(true);
    };

    const canSave = Boolean(draft.trim()) && draft.trim() !== instance.name;

    const save = async () => {
      if (!canSave) {
        setEditing(false);
        return;
      }
      setSaving(true);
      try {
        await onRename({ id: instance.id, name: draft.trim() });
        setEditing(false);
      } catch (error) {
        toast.error(describeError(error, t, t('environments.instances.renameFailed')));
      } finally {
        setSaving(false);
      }
    };

    if (editing) {
      return (
        <Flexbox className={styles.row} gap={8}>
          <Input
            autoFocus
            disabled={saving}
            placeholder={t('environments.instances.namePlaceholder')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void save();
              }
              if (event.key === 'Escape') setEditing(false);
            }}
          />
          <Flexbox horizontal align={'center'} gap={8}>
            <Flexbox flex={1} gap={2}>
              <Text fontSize={12} type={'secondary'}>
                {instance.workingDirectory}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                {t('environments.instances.directoryLocked')}
              </Text>
            </Flexbox>
            <ActionIcon
              disabled={saving}
              icon={XIcon}
              size={'small'}
              title={t('environments.cancel')}
              onClick={() => setEditing(false)}
            />
            <ActionIcon
              disabled={!canSave}
              icon={CheckIcon}
              loading={saving}
              size={'small'}
              title={t('environments.instances.rename')}
              onClick={save}
            />
          </Flexbox>
        </Flexbox>
      );
    }

    return (
      <Flexbox horizontal align={'center'} className={styles.row} gap={8}>
        {/* One line: the folder after the name, the way the environment row
            carries its description. It yields first when the row is narrow,
            since the name is what the instance is picked by. */}
        <Flexbox horizontal align={'baseline'} flex={1} gap={8} style={{ minWidth: 0 }}>
          <Text ellipsis fontSize={13} style={{ flex: '0 1 auto', minWidth: 0 }} weight={500}>
            {instance.name}
          </Text>
          <Text
            ellipsis
            fontSize={12}
            style={{ flex: '0 1000 auto', minWidth: 0 }}
            type={'secondary'}
          >
            {instance.workingDirectory}
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
          {/* An instance that was created but never used has no snapshot,
          which is a normal state and not an error. */}
          {snapshotsUnavailable || snapshotsPending
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
          onClick={() => openInstanceFileBrowser(instance)}
        />
        {editable && (
          <ActionIcon
            icon={PencilIcon}
            size={'small'}
            title={t('environments.instances.rename')}
            onClick={startEditing}
          />
        )}
        {editable && (
          <ActionIcon
            icon={Trash2Icon}
            size={'small'}
            title={t('environments.instances.remove')}
            // Asked first: the delete takes the snapshot with it, and the
            // icon sits one slot from "browse", so a slip was a lost copy.
            onClick={() =>
              confirmModal({
                content: t('environments.instances.removeConfirmContent'),
                cancelText: t('cancel', { ns: 'common' }),
                okButtonProps: { danger: true },
                okText: t('environments.instances.remove'),
                // A rejected promise here used to disappear: the row stayed,
                // and a refused delete was indistinguishable from a click that
                // did nothing. The execution plane refuses while a
                // conversation is still using the instance, and that reason
                // is the one worth showing.
                onOk: () =>
                  onRemove(instance.id).catch((error: unknown) =>
                    toast.error(
                      (error as { message?: string })?.message ||
                        t('environments.instances.removeFailed'),
                    ),
                  ),
                title: t('environments.instances.removeConfirmTitle', { name: instance.name }),
              })
            }
          />
        )}
      </Flexbox>
    );
  },
);

InstanceRow.displayName = 'InstanceRow';

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
    onCreate,
    onRemove,
    onRename,
    snapshotsPending,
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
        {/* A first-use empty state, not a line saying "none": it says what to
            do here and where the instance is picked up afterwards, which is
            the half of the story this panel cannot show. The create button
            lives inside it, so an empty list has one call to action rather
            than a placeholder above the same button. */}
        {instances.length === 0 && !adding && (
          <Center paddingBlock={16}>
            <Empty
              descriptionProps={{ fontSize: 13 }}
              icon={LayersIcon}
              style={{ maxWidth: 360 }}
              title={t('environments.instances.empty')}
              action={
                editable ? (
                  <Button icon={<Icon icon={PlusIcon} />} onClick={() => onAddingChange(true)}>
                    {t('environments.instances.add')}
                  </Button>
                ) : undefined
              }
              description={t(
                editable
                  ? 'environments.instances.emptyHint'
                  : 'environments.instances.emptyReadonly',
              )}
            />
          </Center>
        )}

        {instances.length > 0 && (
          <Flexbox className={styles.list}>
            {instances.map((instance) => (
              <InstanceRow
                editable={editable}
                instance={instance}
                key={instance.id}
                snapshotsPending={snapshotsPending}
                snapshotsUnavailable={snapshotsUnavailable}
                onRemove={onRemove}
                onRename={onRename}
              />
            ))}
          </Flexbox>
        )}

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
                <Button onClick={() => onAddingChange(false)}>{t('environments.cancel')}</Button>
                <Button disabled={!canCreate} loading={busy} type={'primary'} onClick={create}>
                  {t('environments.instances.confirm')}
                </Button>
              </Flexbox>
            </Flexbox>
          </Flexbox>
        ) : instances.length === 0 ? null : (
          <Flexbox horizontal>
            <Button icon={<Icon icon={PlusIcon} />} onClick={() => onAddingChange(true)}>
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
