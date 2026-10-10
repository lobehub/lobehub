'use client';

import { Github } from '@lobehub/icons';
import {
  ActionIcon,
  Button,
  Center,
  confirmModal,
  createStaticStyles,
  cssVar,
  Empty,
  Flexbox,
  Icon,
  Tag,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import {
  CircleAlertIcon,
  CircleDashedIcon,
  CircleStopIcon,
  FolderOpenIcon,
  LayersIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openCreateInstanceModal, openEditInstanceModal } from './CreateInstanceModal';
import { describeError } from './errorMessage';
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
  /**
   * A delete in flight. The row is still here because it is still there — the
   * archive is being removed and the call can still be refused — so it is
   * dimmed rather than taken away, and its own actions stop responding.
   */
  removing: css`
    pointer-events: none;
    opacity: 0.5;
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
  /** Nobody's occupancy could be read, so no row can claim to be free. */
  occupancyUnavailable: boolean;
  onBuild: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Ends the run holding an instance; `stopped: false` when nothing was. */
  onStop: (id: string) => Promise<{ stopped: boolean }>;
  /** `owner/name` of the environment's checkout, when it builds from one. */
  repository?: string;
}

interface InstanceRowProps {
  editable: boolean;
  instance: SandboxInstance;
  onBuild: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<{ stopped: boolean }>;
  repository?: string;
}

/**
 * What a build is doing, what it left behind when it failed, or that there has
 * never been one.
 *
 * The log is collapsed by default and opened on demand: while everything is
 * going right it is thousands of lines nobody reads, and the one time it
 * matters is the time the row says it failed.
 */
const BuildLine = memo<{
  error?: string | null;
  log: string;
  /** Absent for someone who cannot build this instance; the button goes too. */
  onBuild?: () => void;
  /** Present when the status poll itself failed, rather than the build. */
  onRetry?: () => void;
  state: 'failed' | 'running' | 'stalled' | 'unbuilt';
}>(({ error, log, onBuild, onRetry, state }) => {
  const { t } = useTranslation('setting');
  const [open, setOpen] = useState(false);

  // The accumulated stream while it runs; the stored tail once it is over —
  // the runtime drops a finished build's log, so after a reload the row's own
  // record is all there is. An instance never built has no log at all.
  const text = state === 'unbuilt' ? '' : log || error || '';
  const danger = state === 'failed' || state === 'stalled';

  return (
    <Flexbox gap={6}>
      <Flexbox horizontal align={'center'} gap={8}>
        {state === 'running' ? (
          <Icon spin icon={Loader2Icon} size={13} />
        ) : danger ? (
          <Icon icon={CircleAlertIcon} size={13} style={{ color: cssVar.colorError }} />
        ) : (
          <Icon icon={CircleDashedIcon} size={13} style={{ color: cssVar.colorTextTertiary }} />
        )}
        <Text fontSize={12} type={danger ? 'danger' : 'secondary'}>
          {t(
            state === 'running'
              ? 'environments.instances.building'
              : state === 'stalled'
                ? 'environments.instances.buildStatusUnknown'
                : state === 'failed'
                  ? 'environments.instances.buildFailed'
                  : 'environments.instances.notBuilt',
          )}
        </Text>
        {state === 'stalled' && onRetry && (
          <Button size={'small'} type={'text'} onClick={onRetry}>
            {t('environments.instances.retryStatus')}
          </Button>
        )}
        {text && (
          <Button size={'small'} type={'text'} onClick={() => setOpen(!open)}>
            {t(open ? 'environments.instances.hideLog' : 'environments.instances.showLog')}
          </Button>
        )}
        {state !== 'running' && state !== 'stalled' && onBuild && (
          <Button size={'small'} type={'text'} onClick={onBuild}>
            {t(
              state === 'unbuilt'
                ? 'environments.instances.build'
                : 'environments.instances.rebuild',
            )}
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
  ({ editable, instance, onBuild, onRemove, onStop, repository }) => {
    const { t } = useTranslation('setting');

    // Worth following only while something is in flight. A settled instance
    // must not keep a poll running: the query writes when a build ends, so an
    // idle one would be a round trip every two seconds for a row nobody is
    // looking at.
    const building = instance.status === 'pending' && Boolean(instance.buildId);
    const {
      error: pollError,
      log,
      retry,
      state,
    } = useInstanceBuild(instance.id, building, instance.buildId);
    // Made before instances built themselves, or its build request never
    // arrived: pending with nothing to follow. Without saying so the row looks
    // settled while the folder behind it is empty.
    const unbuilt = instance.status === 'pending' && !instance.buildId && instance.buildable;

    // Bridges the gap between confirming and the refreshed row arriving. The
    // request is not instant — starting a build cold-starts a sandbox — and
    // without this the row would look untouched for that whole time, which is
    // exactly what the dialog used to cover by staying open.
    const [starting, setStarting] = useState(false);
    // Same bridge for a delete, which is slower still: it cold-starts a sandbox
    // and then removes the whole archive, gigabytes of it. The row says so and
    // comes back if the execution plane refuses.
    const [removing, setRemoving] = useState(false);
    // And for a stop, which saves the run's snapshot before it ends it — a few
    // seconds at best. Until the refreshed row lands the badge still reads
    // Running, so the row says the stop is under way rather than looking like
    // the click did nothing.
    const [stopping, setStopping] = useState(false);
    // A build holds the same lease, but it is the instance's writer until it
    // publishes and the execution plane will not cut it off; its own line
    // already says it is building.
    const stoppable = editable && instance.inUse && instance.status !== 'pending';

    // Asked first: the run it ends may be a conversation in the middle of a
    // step, and the icon sits beside the badge that only meant to explain.
    const confirmStop = () =>
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('environments.instances.stopConfirmContent'),
        okText: t('environments.instances.stop'),
        // Not awaited, like the build and the delete: the row carries the
        // progress, and a refusal comes back as a toast that says why — most
        // often that the snapshot is still saving, which is worth retrying.
        onOk: () => {
          setStopping(true);
          void onStop(instance.id)
            .then(({ stopped }) =>
              toast.success(
                t(
                  stopped ? 'environments.instances.stopped' : 'environments.instances.stopNothing',
                  { name: instance.name },
                ),
              ),
            )
            .catch((error: unknown) =>
              toast.error(describeError(error, t, t('environments.instances.stopFailed'))),
            )
            .finally(() => setStopping(false));
        },
        title: t('environments.instances.stopConfirmTitle', { name: instance.name }),
      });

    // Every build started from the row is asked first, the first one included:
    // a build replaces the folder with a fresh checkout, and an instance that
    // was never built may still hold what conversations wrote into it.
    const confirmBuild = () =>
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('environments.instances.rebuildConfirmContent'),
        okButtonProps: { danger: true },
        okText: t(unbuilt ? 'environments.instances.build' : 'environments.instances.rebuild'),
        // Deliberately not awaited, so the dialog closes on the click. Holding
        // it until the sandbox is up made confirming feel like the thing might
        // fail, which is the same reason creating an instance fires its build
        // after its dialog is gone. Refusals — "a conversation is using it" is
        // the usual one — leave the row as it was, so the toast still carries
        // the reason; it now lands over the list rather than over a dialog.
        onOk: () => {
          setStarting(true);
          void onBuild(instance.id)
            .catch((error: unknown) =>
              toast.error(describeError(error, t, t('environments.instances.buildStartFailed'))),
            )
            .finally(() => setStarting(false));
        },
        title: t(
          unbuilt
            ? 'environments.instances.buildConfirmTitle'
            : 'environments.instances.rebuildConfirmTitle',
          { name: instance.name },
        ),
      });

    return (
      <Flexbox className={removing ? `${styles.row} ${styles.removing}` : styles.row} gap={6}>
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
          {/* Whether a conversation is in this instance right now — the one
        thing about a row that changes while someone is looking at it, and what
        decides whether deleting or rebuilding it will be refused.

        This slot used to carry the environment snapshot's size, which is a
        property of the archive and not of the instance: an environment that
        installs nothing never produces one, so the column sat at "nothing to
        save" no matter how much work the instance held. The size that would
        actually answer "how much is this using" — the instance's own directory
        on the volume — is not measured per instance at all; the environment
        row's total is where storage is reported.

        Shown only while held, the way the composer's own menu badges it.
        Labelling every idle row "idle" would put a word on each line to say
        that nothing is happening. A lease store that did not answer says
        nothing here either: the line under the list reports that, rather than
        each row quietly implying it is free. */}
          {instance.inUse && (
            // The badge says what is true; the hint says what it means for the
            // person looking at it: how long the hold lasts, that the owner
            // can end it now, and that Run history is where the conversation
            // holding it can be found.
            <Tooltip
              title={t(
                stoppable
                  ? 'environments.instances.runningHintStoppable'
                  : 'environments.instances.runningHint',
              )}
            >
              <Tag color={'processing'} size={'small'}>
                {t('environments.instances.running')}
              </Tag>
            </Tooltip>
          )}
          {/* Beside the badge it ends. The owner's, like a rebuild: in a
            published environment the run is usually a colleague's. */}
          {stoppable && (
            <ActionIcon
              disabled={stopping}
              icon={CircleStopIcon}
              loading={stopping}
              size={'small'}
              title={t('environments.instances.stop')}
              onClick={confirmStop}
            />
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
          {/* Rebuilding a working copy is how it gets back to a clean checkout,
            so it sits with the row's own actions once the instance is ready.
            An instance a conversation holds is refused by the server, and
            said so here first rather than after a confirmation. Absent when
            the definition clones and installs nothing: there is nothing a
            rebuild would redo. */}
          {editable && instance.status === 'ready' && instance.buildable && (
            <ActionIcon
              // `starting` too: the row still reads ready until the refreshed
              // one lands, and a second click in that window starts a second
              // build of the same instance.
              disabled={instance.inUse || starting}
              icon={RotateCcwIcon}
              size={'small'}
              title={t(
                instance.inUse ? 'environments.instances.inUse' : 'environments.instances.rebuild',
              )}
              onClick={confirmBuild}
            />
          )}
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
              disabled={removing}
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
                  // Not awaited, for the same reason a build is not: removing
                  // an archive cold-starts a sandbox and then deletes
                  // gigabytes, and a dialog held open for that reads as a
                  // delete that might not be working. The row says what is
                  // happening instead, and stays until the row is actually
                  // gone.
                  //
                  // A rejected promise here used to disappear: the row stayed,
                  // and a refused delete was indistinguishable from a click that
                  // did nothing. The execution plane refuses while a
                  // conversation is still using the instance, and that reason
                  // is the one worth showing.
                  onOk: () => {
                    setRemoving(true);
                    void onRemove(instance.id)
                      .catch((error: unknown) => {
                        // Through the same translator the other refusals use:
                        // raw, the execution plane's answer names the row by
                        // its id ("Environment \"e299f341-…\" is currently in
                        // use"), which is not a sentence to hand a person.
                        toast.error(
                          describeError(error, t, t('environments.instances.removeFailed')),
                        );
                        // Only on failure: a row that really went away unmounts
                        // with this state, and clearing it on success would
                        // flash the row back to normal first.
                        setRemoving(false);
                      })
                      .catch(() => {});
                  },
                  title: t('environments.instances.removeConfirmTitle', { name: instance.name }),
                })
              }
            />
          )}
        </Flexbox>

        {/* The build, on its own line under the row rather than as a status
            word beside the size. It is minutes long and it can fail, and a
            failure is only useful with the log that caused it — none of which
            fits in a column. Also there for an instance never built, whose
            folder is empty however settled the row looks. Absent once an
            instance is ready, which is where it spends its life. */}
        {(removing || stopping) && (
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon spin icon={Loader2Icon} size={13} />
            <Text fontSize={12} type={'secondary'}>
              {t(removing ? 'environments.instances.removing' : 'environments.instances.stopping')}
            </Text>
          </Flexbox>
        )}

        {!removing && (starting || building || unbuilt || instance.status === 'error') && (
          <BuildLine
            error={instance.buildError}
            log={log}
            state={
              // A poll that ran out of retries is not a running build. Left as
              // one the row spins forever with nothing to click.
              pollError && building && !state
                ? 'stalled'
                : starting || (building && state !== 'failed')
                  ? 'running'
                  : unbuilt
                    ? 'unbuilt'
                    : 'failed'
            }
            // Building a copy is the owner's; everyone else reads the state.
            onBuild={editable ? confirmBuild : undefined}
            onRetry={retry}
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
    occupancyUnavailable,
    onBuild,
    onRemove,
    onStop,
    repository,
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
                onBuild={onBuild}
                onRemove={onRemove}
                onStop={onStop}
              />
            ))}
          </Flexbox>
        )}

        {/* Said once under the set rather than on each row: with occupancy
            unread every row would otherwise look idle, which is the one
            reading this must not offer. */}
        {occupancyUnavailable && instances.length > 0 && (
          <Text fontSize={12} type={'secondary'}>
            {t('environments.instances.occupancyUnavailable')}
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
