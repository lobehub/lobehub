'use client';

import { Github } from '@lobehub/icons';
import { DropdownMenu, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { Avatar, Button, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import { ContainerIcon, MoreHorizontalIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { repositoryPath } from './repository';
import { type SandboxEnvironment, useEnvironmentActions } from './useEnvironmentData';

const styles = createStaticStyles(({ css }) => ({
  /**
   * The counts. `flex: none` and no ellipsis: they are the shortest thing on
   * the line, so a long repository path has to truncate itself rather than
   * squeeze out the answer to "how many instances does this have".
   */
  facts: css`
    flex: none;
    font-size: ${cssVar.fontSizeSM};
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
  ({ environment, instanceCount, onCreateInstance, onSelect, selected }) => {
    const { t } = useTranslation('setting');
    const actions = useEnvironmentActions();

    const repository = repositoryPath(environment.configuration);
    const creator =
      environment.creator?.fullName ||
      environment.creator?.username ||
      t('environments.meta.unknownCreator');

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
          <Text ellipsis fontSize={15} weight={500}>
            {environment.name}
          </Text>
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
                <Avatar avatar={environment.creator.avatar ?? undefined} size={20} />
              </span>
            </Tooltip>
          )}
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
        </Flexbox>
      </Flexbox>
    );
  },
);

EnvironmentItem.displayName = 'EnvironmentItem';

export default EnvironmentItem;
