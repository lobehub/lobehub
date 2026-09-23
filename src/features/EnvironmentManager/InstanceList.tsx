'use client';

import { Github } from '@lobehub/icons';
import { Center, Empty, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { ActionIcon, Button, confirmModal, Skeleton, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  CircleAlertIcon,
  FolderOpenIcon,
  LayersIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import { openCreateInstanceModal, openEditInstanceModal } from './CreateInstanceModal';
import { openInstanceFileBrowser } from './InstanceFileBrowser';
import type { SandboxInstance } from './useEnvironmentData';
import { useInstanceBuild } from './useEnvironmentData';

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
  /** A build's output, when someone opens it — usually because it failed. */
  log: css`
    overflow: auto;

    max-height: 220px;
    margin: 0;
    padding: 8px;
    border-radius: ${cssVar.borderRadius};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    word-break: break-all;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  row: css`
    padding-block: 12px;
    padding-inline: 16px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
}));

interface InstanceListProps {
  /**
   * Whether the caller owns the environment these belong to. A published
   * environment is one a colleague can run in, not one they can add copies to
   * or delete copies from, so the controls go away rather than fail.
   */
  editable: boolean;
  environmentId: string;
  instances: SandboxInstance[];
  onBuild: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** `owner/name` of the environment's checkout, when it builds from one. */
  repository?: string;
  /** Sizes are still on their way from the execution plane. */
  snapshotsPending: boolean;
  /** Sizes are missing rather than zero when the sandbox could not be reached. */
  snapshotsUnavailable: boolean;
}

interface InstanceRowProps {
  editable: boolean;
  instance: SandboxInstance;
  onBuild: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  repository?: string;
  snapshotsPending: boolean;
  snapshotsUnavailable: boolean;
}

/**
 * What a build is doing, and what it left behind when it failed.
 *
 * The log is collapsed by default and opened on demand: while everything is
 * going right it is thousands of lines nobody reads, and the one time it
 * matters is the time the row says it failed.
 */
const BuildLine = memo<{
  error?: string | null;
  failed: boolean;
  log: string;
  onRetry: () => void;
  running: boolean;
}>(({ error, failed, log, onRetry, running }) => {
  const { t } = useTranslation('setting');
  const [open, setOpen] = useState(false);

  // The accumulated stream while it runs; the stored tail once it is over —
  // the runtime drops a finished build's log, so after a reload the row's own
  // record is all there is.
  const text = log || error || '';

  return (
    <Flexbox gap={6}>
      <Flexbox horizontal align={'center'} gap={8}>
        {running ? (
          <Icon spin icon={Loader2Icon} size={13} />
        ) : (
          <Icon icon={CircleAlertIcon} size={13} style={{ color: cssVar.colorError }} />
        )}
        <Text fontSize={12} type={failed && !running ? 'danger' : 'secondary'}>
          {t(running ? 'environments.instances.building' : 'environments.instances.buildFailed')}
        </Text>
        {text && (
          <Button size={'small'} type={'text'} onClick={() => setOpen(!open)}>
            {t(open ? 'environments.instances.hideLog' : 'environments.instances.showLog')}
          </Button>
        )}
        {!running && (
          <Button size={'small'} type={'text'} onClick={onRetry}>
            {t('environments.instances.rebuild')}
          </Button>
        )}
      </Flexbox>
      {open && text && <pre className={styles.log}>{text}</pre>}
    </Flexbox>
  );
});

BuildLine.displayName = 'InstanceBuildLine';

/**
 * One instance, as it is.
 *
 * Renaming opens the same dialog that made it, rather than turning the row
 * into a field: the folder cannot change and the row had nowhere to say so,
 * so the one thing worth explaining was the one thing an inline editor hid.
 */
const InstanceRow = memo<InstanceRowProps>(
  ({
    editable,
    instance,
    onBuild,
    onRemove,
    repository,
    snapshotsPending,
    snapshotsUnavailable,
  }) => {
    const { t } = useTranslation('setting');

    // Worth following only while something is in flight. A settled instance
    // must not keep a poll running: the query writes when a build ends, so an
    // idle one would be a round trip every two seconds for a row nobody is
    // looking at.
    const building = instance.status === 'pending' && Boolean(instance.buildId);
    const { log, state } = useInstanceBuild(instance.id, building);

    return (
      <Flexbox className={styles.row} gap={6}>
        <Flexbox horizontal align={'center'} gap={8}>
          {/* One line: the folder after the name, the way the environment row
            carries its description. It yields first when the row is narrow,
            since the name is what the instance is picked by. */}
          <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }}>
            {/* What this copy was cut from. On the instance and not only on the
              environment header because the row is what gets browsed, renamed
              and deleted, and its own folder name says nothing about the
              checkout it holds. */}
            {repository && (
              <Tooltip title={repository}>
                <Flexbox style={{ flex: 'none' }}>
                  <Github size={14} />
                </Flexbox>
              </Tooltip>
            )}
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
          </Flexbox>
          {/* Three states, and they are not the same thing. Still on its way
        from the execution plane is a wait, so it looks like one — a dash there
        reads as a settled answer and this one has not arrived. Never used is a
        real answer. The dash is what is left: asked for and not obtained, which
        the line under the list explains and this repeats on hover. */}
          {snapshotsPending ? (
            <Skeleton.Text rows={1} style={{ height: 14, width: 44 }} />
          ) : (
            <Tooltip
              title={
                snapshotsUnavailable ? t('environments.instances.snapshotsUnavailable') : undefined
              }
            >
              <Text fontSize={12} type={'secondary'}>
                {snapshotsUnavailable
                  ? '—'
                  : instance.snapshot
                    ? formatSize(instance.snapshot.bytes)
                    : t('environments.instances.unused')}
              </Text>
            </Tooltip>
          )}
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
              onClick={() => openEditInstanceModal(instance)}
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

        {/* The build, on its own line under the row rather than as a status
            word beside the size. It is minutes long and it can fail, and a
            failure is only useful with the log that caused it — none of which
            fits in a column. Absent entirely once an instance is ready, which
            is where it spends its life. */}
        {(building || instance.status === 'error') && (
          <BuildLine
            error={instance.buildError}
            failed={instance.status === 'error'}
            log={log}
            running={building && state !== 'failed'}
            onRetry={() => void onBuild(instance.id)}
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
    editable,
    environmentId,
    instances,
    onBuild,
    onRemove,
    repository,
    snapshotsPending,
    snapshotsUnavailable,
  }) => {
    const { t } = useTranslation('setting');

    const add = () => openCreateInstanceModal({ environmentId });

    return (
      <Flexbox gap={8}>
        {/* A first-use empty state, not a line saying "none": it says what to
            do here and where the instance is picked up afterwards, which is
            the half of the story this panel cannot show. The create button
            lives inside it, so an empty list has one call to action rather
            than a placeholder above the same button. */}
        {instances.length === 0 && (
          <Center paddingBlock={16}>
            <Empty
              descriptionProps={{ fontSize: 13 }}
              icon={LayersIcon}
              style={{ maxWidth: 360 }}
              title={t('environments.instances.empty')}
              action={
                editable ? (
                  <Button icon={<Icon icon={PlusIcon} />} onClick={add}>
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
                repository={repository}
                snapshotsPending={snapshotsPending}
                snapshotsUnavailable={snapshotsUnavailable}
                onBuild={onBuild}
                onRemove={onRemove}
              />
            ))}
          </Flexbox>
        )}

        {snapshotsUnavailable && instances.length > 0 && (
          <Text fontSize={12} type={'secondary'}>
            {t('environments.instances.snapshotsUnavailable')}
          </Text>
        )}

        {/* Below the framed list, as an addition to the set rather than a line
            in it. The form itself opens as a dialog: the same one the composer
            uses, so making an instance asks the same two questions wherever
            it starts. */}
        {editable && instances.length > 0 && (
          <Flexbox horizontal>
            <Button icon={<Icon icon={PlusIcon} />} onClick={add}>
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
