'use client';

import { Github } from '@lobehub/icons';
import {
  Button,
  confirmModal,
  DropdownMenu,
  Flexbox,
  Icon,
  Text,
  toast,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { EyeOffIcon, GlobeIcon, MoreHorizontalIcon, Trash2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/components/UserAvatar';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';

import { describeError } from './errorMessage';
import { repositoryPath } from './repository';
import { useCanEditEnvironment } from './useCanEditEnvironment';
import { useConfirmRemoveEnvironment } from './useConfirmRemoveEnvironment';
import { type SandboxEnvironment, useEnvironmentActions } from './useEnvironmentData';

const styles = stylex.create({
  facts: {
    overflow: 'hidden',
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: '0',
    fontSize: cssVar.fontSizeSM,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  iconTile: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  metaDivider: {
    flex: 'none',
    width: '1px',
    height: '10px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  repository: {
    overflow: 'hidden',
    flexGrow: 0,
    flexShrink: 1000,
    flexBasis: 'auto',
    minWidth: '0',
    fontSize: cssVar.fontSizeSM,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  row: {
    cursor: 'pointer',
    paddingBlock: '12px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    transition: {
      'default': 'background 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-1px' },
  },
  rowActive: {
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
});

interface EnvironmentItemProps {
  environment: SandboxEnvironment;
  onSelect: () => void;
  selected?: boolean;
}

/**
 * One environment, as a row.
 *
 * What the row answers is what someone scanning the list is asking: which
 * repository is this, and who put it here. Every
 * other property of an environment — setup command, variables, branch — is a
 * detail of one environment rather than a way to tell environments apart, so it
 * lives in the panel this row opens.
 */
const EnvironmentItem = memo<EnvironmentItemProps>(({ environment, onSelect, selected }) => {
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
        toast.error(describeError(error, t, t('environments.visibility.changeFailed'))),
      );

  const publish = () =>
    confirmModal({
      // The shared dialog, because this is the same decision a shared device
      // asks about and an answer learned once should transfer — plus the
      // bullet only an environment needs: a copy built before environments
      // became initializers keeps its captured home directory and logins, and
      // publishing hands those to every member along with the row.
      content: <VisibilityConfirmContent capturedState variant={'publish'} />,
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

  const confirmRemoveEnvironment = useConfirmRemoveEnvironment();
  const confirmRemove = () => confirmRemoveEnvironment(environment);

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.row, selected && styles.rowActive).className}
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
      <div className={stylex.props(styles.iconTile).className}>
        <Github size={20} />
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
              <Text className={stylex.props(styles.repository).className} type={'secondary'}>
                {repository}
              </Text>
              <span className={stylex.props(styles.metaDivider).className} />
            </>
          )}
          <Text className={stylex.props(styles.facts).className} type={'secondary'}>
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
              <UserAvatar avatar={environment.creator.avatar} name={creator} size={20} />
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
                ...visibilityItems,
                {
                  danger: true,
                  icon: <Icon icon={Trash2Icon} />,
                  key: 'remove',
                  label: t('environments.remove'),
                  onClick: confirmRemove,
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
});

EnvironmentItem.displayName = 'EnvironmentItem';

export default EnvironmentItem;
