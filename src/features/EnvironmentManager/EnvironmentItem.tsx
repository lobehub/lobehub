'use client';

import { Github } from '@lobehub/icons';
import { DropdownMenu, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Avatar, Button, confirmModal, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import {
  ContainerIcon,
  EyeOffIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { formatSize } from '@/utils/format';

import { repositoryPath } from './repository';
import { useCanEditEnvironment } from './useCanEditEnvironment';
import { type SandboxEnvironment, useEnvironmentActions } from './useEnvironmentData';

const styles = createStaticStyles(({ css }) => ({
  /**
   * The counts. They shrink last: a long repository path gives way first
   * (its shrink weight is far higher), but with the panel open the list is a
   * third of the frame and even the facts alone can outrun it, so they
   * truncate rather than run under the avatar and the menu.
   */
  facts: css`
    overflow: hidden;
    flex: 0 1 auto;

    min-width: 0;

    font-size: ${cssVar.fontSizeSM};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  iconTile: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;
    border-radius: 12px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  metaDivider: css`
    flex: none;
    width: 1px;
    height: 10px;
    background: ${cssVar.colorBorderSecondary};
  `,
  repository: css`
    overflow: hidden;
    flex: 0 1000 auto;

    min-width: 0;

    font-size: ${cssVar.fontSizeSM};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  row: css`
    cursor: pointer;

    padding-block: 12px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    transition: background 0.15s ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -1px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  rowActive: css`
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));

interface EnvironmentItemProps {
  environment: SandboxEnvironment;
  instanceCount: number;
  /** Select this environment AND open its instance-create form in the panel. */
  onCreateInstance: () => void;
  onSelect: () => void;
  selected?: boolean;
  /**
   * Bytes kept by this environment's instances, or `null` when the snapshot
   * store could not be reached and the sizes are unknown rather than zero.
   */
  storageBytes?: number | null;
}

/**
 * One environment, as a row.
 *
 * What the row answers is what someone scanning the list is asking: which
 * repository is this, how many instances does it have, who put it here. Every
 * other property of an environment — setup command, variables, branch — is a
 * detail of one environment rather than a way to tell environments apart, so it
 * lives in the panel this row opens.
 */
const EnvironmentItem = memo<EnvironmentItemProps>(
  ({ environment, instanceCount, onCreateInstance, onSelect, selected, storageBytes }) => {
    const { t } = useTranslation('setting');
    const { t: tCommon } = useTranslation('common');
    const actions = useEnvironmentActions();
    const canEdit = useCanEditEnvironment()(environment);

    const repository = repositoryPath(environment.configuration);
    const creator =
      environment.creator?.fullName ||
      environment.creator?.username ||
      t('environments.meta.unknownCreator');

    const setVisibility = (visibility: 'private' | 'public') =>
      actions
        .setEnvironmentVisibility({ id: environment.id, visibility })
        .catch((error: unknown) =>
          toast.error(
            (error as { message?: string })?.message || t('environments.visibility.changeFailed'),
          ),
        );

    const publish = () =>
      confirmModal({
        // The shared dialog, because this is the same decision a shared device
        // asks about and an answer learned once should transfer.
        content: <VisibilityConfirmContent variant={'publish'} />,
        okText: t('environments.visibility.publish'),
        onOk: () => setVisibility('public'),
        title: t('environments.visibility.publishConfirmTitle'),
      });

    const makePrivate = () =>
      confirmModal({
        content: <VisibilityConfirmContent variant={'makePrivate'} />,
        okButtonProps: { danger: true },
        okText: tCommon('makePrivate.confirm.ok'),
        onOk: () => setVisibility('private'),
        title: tCommon('makePrivate.confirm.title'),
      });

    // Only a workspace row has a pool to be in, and only its creator may move
    // it between pools — demoting a colleague's published environment would
    // take away instances other people are working in.
    const visibilityItems =
      environment.workspaceId && canEdit
        ? environment.visibility === 'private'
          ? [
              {
                icon: <Icon icon={GlobeIcon} />,
                key: 'publish',
                label: t('environments.visibility.publish'),
                onClick: publish,
              },
            ]
          : [
              {
                icon: <Icon icon={EyeOffIcon} />,
                key: 'makePrivate',
                label: tCommon('makePrivate'),
                onClick: makePrivate,
              },
            ]
        : [];

    const remove = () =>
      actions
        .removeEnvironment(environment.id)
        // A refusal has to reach the person. An environment still holding
        // instances is refused on purpose, and that is what they need to read.
        .catch((error: unknown) =>
          toast.error((error as { message?: string })?.message || t('environments.removeFailed')),
        );

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={cx(styles.row, selected && styles.rowActive)}
        gap={16}
        role={'button'}
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => {
          // Mirror native button keyboard semantics for the div-as-button row.
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        <div className={styles.iconTile}>
          {repository ? <Github size={20} /> : <Icon icon={ContainerIcon} size={20} />}
        </div>

        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          {/* No "published by" badge beside the name. The avatar on the right
              already names the author on hover, and inside the published pool
              every row is published by definition — the badge printed the same
              fact twice and took the width the name needed. */}
          {/* The description sits after the name rather than on a line of its
              own: it is a gloss on the name, not a second fact, and a third
              line made every row taller for the rows that have one. It gives
              way first, since the name is what the row is found by. */}
          <Flexbox horizontal align={'baseline'} gap={8} style={{ minWidth: 0 }}>
            <Text ellipsis fontSize={15} style={{ flex: '0 1 auto', minWidth: 0 }} weight={500}>
              {environment.name}
            </Text>
            {environment.description && (
              /* Shrinks a thousand times more readily than the name, the same
                 way the repository yields to the facts on the line below. */
              <Text
                ellipsis
                fontSize={13}
                style={{ flex: '0 1000 auto', minWidth: 0 }}
                type={'secondary'}
              >
                {environment.description}
              </Text>
            )}
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            {/* The repository leads because it is what the name is usually taken
                from, and it truncates because it is the only part of this line
                that can afford to. */}
            {repository && (
              <>
                <Text className={styles.repository} type={'secondary'}>
                  {repository}
                </Text>
                <span className={styles.metaDivider} />
              </>
            )}
            <Text className={styles.facts} type={'secondary'}>
              {instanceCount === 0
                ? t('environments.instances.empty')
                : t('environments.instances.count', { count: instanceCount })}
              {/* Snapshot storage, not live disk: what the instances have
                  kept, which is what a plan's quota is spent on. Shown only
                  once something has been kept — instances that were never
                  used add up to nothing, and "0.0 KB" reads as a fault. */}
              {typeof storageBytes === 'number' && storageBytes > 0 && (
                <>
                  {' · '}
                  {t('environments.meta.storage', { size: formatSize(storageBytes) })}
                </>
              )}
              {' · '}
              {t('environments.meta.createdAt', {
                time: dayjs(environment.createdAt).fromNow(),
              })}
            </Text>
          </Flexbox>
        </Flexbox>

        <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none' }}>
          {environment.creator && (
            // Who put this here, at a glance — the same answer the device list
            // gives with the enroller's avatar.
            <Tooltip title={t('environments.meta.creatorTooltip', { name: creator })}>
              <span onClick={(event) => event.stopPropagation()}>
                {/* The name is passed as the avatar itself, not only as
                    `title`. `Avatar` derives its fallback text from
                    `String(avatar)` first, so an undefined picture becomes the
                    literal string "undefined" and every author without one
                    renders the same "UN" — `title` never gets a turn. Since the
                    row carries no badge, that placeholder would be the only
                    thing left saying whose environment this is. */}
                <Avatar avatar={environment.creator.avatar || creator} size={20} title={creator} />
              </span>
            </Tooltip>
          )}
          {/* Nothing here acts on an environment you only have the use of, so
              the menu goes away rather than offering items that would be
              refused. */}
          {canEdit && (
            <span onClick={(event) => event.stopPropagation()}>
              <DropdownMenu
                placement={'bottomRight'}
                items={[
                  {
                    icon: <Icon icon={PlusIcon} />,
                    key: 'create-instance',
                    label: t('environments.instances.create'),
                    onClick: onCreateInstance,
                  },
                  ...visibilityItems,
                  {
                    danger: true,
                    icon: <Icon icon={Trash2Icon} />,
                    key: 'remove',
                    label: t('environments.remove'),
                    onClick: remove,
                  },
                ]}
              >
                <Button icon={MoreHorizontalIcon} />
              </DropdownMenu>
            </span>
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

EnvironmentItem.displayName = 'EnvironmentItem';

export default EnvironmentItem;
