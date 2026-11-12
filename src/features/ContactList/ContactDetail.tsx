'use client';

import { cx, DropdownMenu, Empty, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import {
  MessageCircleIcon,
  MoreHorizontalIcon,
  PencilLineIcon,
  Settings2Icon,
  UserRoundIcon,
  UserRoundXIcon,
} from 'lucide-react';
import { type CSSProperties, memo, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { cardStyles } from '@/features/AgentViewAll/AgentCard';
import { coverPattern } from '@/features/AgentViewAll/coverColor';
import { resolveAgentBadge } from '@/features/AgentViewAll/resolveAgentBadge';
import SidebarItemAvatar from '@/features/AgentViewAll/SidebarItemAvatar';
import { useAgentCoverColor } from '@/features/AgentViewAll/useAgentCoverColor';
import { useChannelsEnabled } from '@/features/Channels/useChannelsEnabled';
import { useAgentConversationLink } from '@/features/MessageList/useAgentConversationLink';
import NavHeader from '@/features/NavHeader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useCopyAgentIdMenuItem } from '@/hooks/useCopyAgentIdMenuItem';

import { ContactInfo } from './ContactInfo';
import { type ContactCardState, useContactCard } from './useContactCard';

const AVATAR_SIZE = 88;
const COVER_HEIGHT = 144;

const styles = stylex.create({
  body: {
    paddingBlockEnd: '48px',
    paddingInline: '24px',
    maxWidth: '520px',
    width: '100%',
    textAlign: 'center',
  },
  // The badge cover from the agents wall, widened into a profile header.
  cover: {
    position: 'relative',
    overflow: 'hidden',
    flexShrink: 0,
    borderRadius: '12px',
    height: `${COVER_HEIGHT}px`,
    width: '100%',
  },
  // The avatar straddles the cover's bottom edge, as on the badge.
  avatar: {
    marginBlockStart: `-${AVATAR_SIZE / 2}px`,
  },
  actions: {
    display: 'grid',
    gridAutoColumns: 'minmax(0, 1fr)',
    gridAutoFlow: 'column',
    gap: '8px',
    width: '100%',
    marginBlockStart: '16px',
  },
  // An IM-profile action: icon over label, the whole tile clickable.
  tile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    paddingBlock: '12px',
    paddingInline: '8px',
    borderWidth: 0,
    borderRadius: '12px',
    fontFamily: 'inherit',
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorText,
    textDecoration: 'none',
    cursor: 'pointer',
    backgroundColor: {
      'default': cssVar.colorFillTertiary,
      ':hover': cssVar.colorFillSecondary,
    },
    transitionProperty: 'background-color',
    transitionDuration: '0.15s',
  },
  state: {
    paddingBlock: '48px',
    paddingInline: '24px',
    maxWidth: '520px',
    width: '100%',
  },
});

const TileContent = ({ icon, label }: { icon: LucideIcon; label: string }) => (
  <>
    <Icon icon={icon} size={20} />
    <span>{label}</span>
  </>
);

// Takes the ref and props a DropdownMenu trigger hands its child.
const MenuTile = ({
  className,
  label,
  ref,
  ...rest
}: {
  className?: string;
  label: string;
  ref?: Ref<HTMLButtonElement>;
}) => (
  <button
    ref={ref}
    type="button"
    {...rest}
    className={cx(stylex.props(styles.tile).className, className)}
  >
    <TileContent icon={MoreHorizontalIcon} label={label} />
  </button>
);

const ContactCard = memo<Extract<ContactCardState, { status: 'ready' }>>(
  ({ canEdit, chatUrl, item, profileUrl, role, slug, title }) => {
    const { t } = useTranslation('common');
    const navigate = useWorkspaceAwareNavigate();
    const badge = resolveAgentBadge(item);
    const coverColor = useAgentCoverColor(item, badge.cover, !!badge.coverImage);
    const isGroup = item.type === 'group';
    const agentId = isGroup ? undefined : item.id;
    // With Channels on, "Message" opens the direct Channel and "View" the Agent's own page;
    // without them both would land on that page, so only "Message" is offered.
    const channelsEnabled = useChannelsEnabled();
    const message = useAgentConversationLink(agentId, chatUrl);
    const copyIdItem = useCopyAgentIdMenuItem(agentId);
    const moreItems = [
      {
        icon: canEdit ? PencilLineIcon : UserRoundIcon,
        key: 'profile',
        label: t(canEdit ? 'contacts.editProfile' : 'contacts.viewProfile'),
        onClick: () => navigate(profileUrl),
      },
      ...(copyIdItem ? [copyIdItem] : []),
    ];

    return (
      <>
        <div {...stylex.props(styles.cover)}>
          <div
            className={cardStyles.cover}
            data-cover-image={badge.coverImage ? '' : undefined}
            data-pattern={badge.coverImage ? undefined : coverPattern(item)}
            style={
              {
                '--agent-cover': coverColor,
                'backgroundImage': badge.coverImage
                  ? `url(${JSON.stringify(badge.coverImage)})`
                  : undefined,
                'height': '100%',
              } as CSSProperties
            }
          />
        </div>
        <Flexbox align={'center'} gap={8} {...stylex.props(styles.body)}>
          <span
            className={cx(
              stylex.props(styles.avatar).className,
              cardStyles.avatarRing,
              !badge.cover && cardStyles.avatarPlain,
              isGroup && cardStyles.avatarRingGroup,
            )}
          >
            <SidebarItemAvatar item={item} shape={'circle'} size={AVATAR_SIZE - 6} />
          </span>
          <Text
            ellipsis
            as={'h1'}
            fontSize={22}
            style={{ margin: 0, maxWidth: '100%' }}
            weight={600}
          >
            {title}
          </Text>
          {role && (
            <span className={cardStyles.role} title={role}>
              {role}
            </span>
          )}
          <div {...stylex.props(styles.actions)}>
            <WorkspaceLink
              to={message.url}
              onClick={message.onClick}
              {...stylex.props(styles.tile)}
            >
              <TileContent icon={MessageCircleIcon} label={t('contacts.sendMessage')} />
            </WorkspaceLink>
            {agentId && channelsEnabled && (
              <WorkspaceLink to={chatUrl} {...stylex.props(styles.tile)}>
                <TileContent icon={Settings2Icon} label={t('contacts.manage')} />
              </WorkspaceLink>
            )}
            <DropdownMenu items={moreItems}>
              <MenuTile label={t('more')} />
            </DropdownMenu>
          </div>
          <ContactInfo agentId={agentId} description={item.description} slug={slug} />
        </Flexbox>
      </>
    );
  },
);

ContactCard.displayName = 'ContactCard';

/**
 * A contact's card beside the Contacts list, laid out like an IM profile: the
 * agents-wall badge widened into a header, Message / View / More actions, and an
 * info list with the handle, mail addresses and bio. Opening a contact only
 * previews it — the conversation and the profile are one click on.
 */
const ContactDetail = memo<{ id: string }>(({ id }) => {
  const { t } = useTranslation('common');
  const card = useContactCard(id);

  switch (card.status) {
    case 'ready': {
      return <ContactCard {...card} />;
    }
    case 'error': {
      return (
        <Flexbox align={'center'} flex={1} justify={'center'} {...stylex.props(styles.state)}>
          <AsyncError error={card.error} variant="inline" onRetry={card.retry} />
        </Flexbox>
      );
    }
    case 'missing': {
      return (
        <Flexbox align={'center'} flex={1} justify={'center'} {...stylex.props(styles.state)}>
          <Empty description={t('contacts.notFound')} icon={UserRoundXIcon} />
        </Flexbox>
      );
    }
    default: {
      return (
        <>
          <Skeleton height={COVER_HEIGHT} radius={12} width={'100%'} />
          <Flexbox align={'center'} gap={12} {...stylex.props(styles.body)}>
            <Skeleton.Avatar
              shape={'circle'}
              size={AVATAR_SIZE}
              style={{ marginBlockStart: -AVATAR_SIZE / 2 }}
            />
            <Skeleton height={28} width={160} />
            <Skeleton.Text rows={2} width={['100%', '60%']} />
          </Flexbox>
        </>
      );
    }
  }
});

ContactDetail.displayName = 'ContactDetail';

export { ContactDetail };

/** `/agents/:id`: the contact card in the content column of the Contacts tab. */
const ContactDetailPage = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader />
      <Flexbox
        align={'center'}
        flex={1}
        paddingInline={16}
        style={{ overflowY: 'auto', paddingBlockStart: 8 }}
      >
        {id && <ContactDetail id={id} key={id} />}
      </Flexbox>
    </Flexbox>
  );
};

export default ContactDetailPage;
