'use client';

import { isDesktop } from '@lobechat/const';
import { ActionIcon, Button, Center, DropdownMenu, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UserRoundIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import Avatar from '@/components/Avatar';
import type { ConnectorLinkSummary, ConnectorWithTools } from '@/store/tool/slices/connector';

import { InlineErrorText } from '../ConnectorActionErrorText';
import { getAccountDetails, getAccountsSectionModel, getRowBusyAction } from './accountsModel';
import ManageTooltip from './ManageTooltip';
import Section from './Section';
import { useConnectorAccountFlows } from './useConnectorAccountFlows';

const AVATAR_SIZE = 28;

const styles = stylex.create({
  empty: {
    color: cssVar.colorTextSecondary,
    fontSize: 13,
    lineHeight: 1.6,
    paddingBlock: 20,
    paddingInline: 16,
    textAlign: 'center',
  },
  glyph: {
    backgroundColor: cssVar.colorFillSecondary,
    borderRadius: '50%',
    color: cssVar.colorTextSecondary,
    flex: 'none',
    height: AVATAR_SIZE,
    width: AVATAR_SIZE,
  },
  hint: {
    color: cssVar.colorTextDescription,
    fontSize: 12,
    lineHeight: 1.5,
  },
  list: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    paddingInline: 12,
  },
  row: {
    borderBlockEndColor: {
      ':last-child': 'transparent',
      'default': cssVar.colorBorderSecondary,
    },
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    minHeight: 52,
    paddingBlock: 12,
  },
});

/** An account without a picture keeps one shared glyph, never initials of its name. */
const AccountGlyph = () => (
  <Center {...stylex.props(styles.glyph)}>
    <Icon icon={UserRoundIcon} size={16} />
  </Center>
);

const AccountAvatar = ({ link }: { link: ConnectorLinkSummary }) =>
  link.profile?.avatar ? (
    <Avatar
      avatar={link.profile.avatar}
      brokenFallback={<AccountGlyph />}
      name={link.name}
      shape={'circle'}
      size={AVATAR_SIZE}
    />
  ) : (
    <AccountGlyph />
  );

interface AccountRowProps {
  /** The action running on this row, if any. */
  busyAction?: 'reauthorize' | 'remove';
  details: string;
  disabled: boolean;
  disabledReason?: string;
  link: ConnectorLinkSummary;
  onReauthorize: () => void;
  onRemove: () => void;
  onRename: () => void;
}

const AccountRow = ({
  busyAction,
  details,
  disabled,
  disabledReason,
  link,
  onReauthorize,
  onRemove,
  onRename,
}: AccountRowProps) => {
  const { t } = useTranslation('tool');
  const hasError = link.status === 'error';

  const menuItems = [
    {
      icon: <Icon icon={PencilIcon} />,
      key: 'rename',
      label: t('connector.account.rename'),
      onClick: onRename,
    },
    {
      icon: <Icon icon={RefreshCwIcon} />,
      key: 'reauthorize',
      label: t('connector.account.reauthorize'),
      onClick: onReauthorize,
    },
    { type: 'divider' as const },
    {
      danger: true,
      icon: <Icon icon={Trash2Icon} />,
      key: 'remove',
      label: t('connector.account.remove'),
      onClick: onRemove,
    },
  ];

  // A tap target on mobile too: no account action is hover-only.
  const moreButton = (
    <ActionIcon
      disabled={disabled}
      icon={MoreHorizontalIcon}
      loading={!hasError && !!busyAction}
      size={'small'}
      title={t('connector.account.more')}
    />
  );

  return (
    <Flexbox horizontal align={'center'} gap={12} {...stylex.props(styles.row)}>
      <AccountAvatar link={link} />
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis strong>
          {link.name}
        </Text>
        {/* The status sits on the second line so a narrow row (with the
            Re-authorize button beside it) never truncates the name first. */}
        {(hasError || details) && (
          <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
            {hasError && (
              <Tag color={'error'} size={'small'} style={{ flex: 'none' }}>
                {t('connector.authError')}
              </Tag>
            )}
            {details && (
              <Text ellipsis fontSize={12} type={'secondary'}>
                {details}
              </Text>
            )}
          </Flexbox>
        )}
      </Flexbox>
      {/* A broken account's next step is on the row, not behind the menu. */}
      {hasError && (
        <ManageTooltip title={disabledReason}>
          <Button
            disabled={disabled}
            loading={busyAction === 'reauthorize'}
            size={'small'}
            style={{ flex: 'none' }}
            onClick={onReauthorize}
          >
            {t('connector.account.reauthorize')}
          </Button>
        </ManageTooltip>
      )}
      <ManageTooltip title={disabledReason}>
        {disabled ? (
          moreButton
        ) : (
          <DropdownMenu items={menuItems} placement={'bottomRight'}>
            {moreButton}
          </DropdownMenu>
        )}
      </ManageTooltip>
    </Flexbox>
  );
};

interface ConnectorAccountsProps {
  /** Account writes follow the connector's maintenance gate (`assertConnectorMaintainable`). */
  canManage: boolean;
  connector: ConnectorWithTools;
  /** Why the controls are disabled, shown on hover; absent while the gate is loading. */
  disabledReason?: string;
}

/**
 * The OAuth accounts connected to one connector. Each account is a `link_id`
 * the model picks by name once there is more than one, so the names here are
 * what the model reads. Mount it keyed by connector id so a running flow's
 * state never shows on another connector.
 */
const ConnectorAccounts = ({ canManage, connector, disabledReason }: ConnectorAccountsProps) => {
  const { t } = useTranslation('tool');
  const workspaceId = useActiveWorkspaceId();
  const { busy, connect, failure, reauthorize, remove, rename } =
    useConnectorAccountFlows(connector);

  const links = connector.links ?? [];
  const model = getAccountsSectionModel({ busy, canManage, connector, isDesktop });
  // A personal space has one member, so every account was authorized by the viewer.
  const formatAuthorizer = workspaceId
    ? (name: string) => t('connector.account.authorizedBy', { name })
    : undefined;

  const addButton = model.add && (
    <ManageTooltip title={disabledReason}>
      <Button
        disabled={!canManage || (!!busy && busy.kind !== 'connect')}
        icon={<Icon icon={PlusIcon} />}
        loading={busy?.kind === 'connect'}
        size={'small'}
        type={model.add.primary ? 'primary' : 'default'}
        onClick={() => void connect()}
      >
        {model.add.kind === 'connect'
          ? t('connector.account.connect')
          : t('connector.account.connectAnother')}
      </Button>
    </ManageTooltip>
  );

  return (
    <Section extra={addButton || undefined} label={t('connector.account.title')}>
      {model.empty ? (
        <div {...stylex.props(styles.list, styles.empty)}>{t('connector.account.empty')}</div>
      ) : (
        <div {...stylex.props(styles.list)}>
          {links.map((link) => (
            <AccountRow
              busyAction={getRowBusyAction(busy, link.id)}
              details={getAccountDetails(link, formatAuthorizer)}
              disabled={model.locked}
              disabledReason={disabledReason}
              key={link.id}
              link={link}
              onReauthorize={() => void reauthorize(link)}
              onRemove={() => remove(link)}
              onRename={() => rename(link)}
            />
          ))}
        </div>
      )}
      {failure && <InlineErrorText>{failure}</InlineErrorText>}
      {model.showNamingHint && (
        <div {...stylex.props(styles.hint)}>{t('connector.account.namingHint')}</div>
      )}
      {model.showSwitchHint && (
        <div {...stylex.props(styles.hint)}>{t('connector.account.switchHint')}</div>
      )}
    </Section>
  );
};

export default ConnectorAccounts;
