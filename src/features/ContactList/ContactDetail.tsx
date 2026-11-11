'use client';

import { Button, cx, Empty, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MessageCircleIcon, PencilLineIcon, UserRoundXIcon } from 'lucide-react';
import { type CSSProperties, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { cardStyles } from '@/features/AgentViewAll/AgentCard';
import { coverPattern } from '@/features/AgentViewAll/coverColor';
import { resolveAgentBadge } from '@/features/AgentViewAll/resolveAgentBadge';
import SidebarItemAvatar from '@/features/AgentViewAll/SidebarItemAvatar';
import { useAgentCoverColor } from '@/features/AgentViewAll/useAgentCoverColor';
import NavHeader from '@/features/NavHeader';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

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
  description: {
    fontSize: '14px',
    lineHeight: '22px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'pre-wrap',
  },
  placeholder: {
    fontSize: '14px',
    color: cssVar.colorTextQuaternary,
  },
  slug: {
    fontSize: '13px',
    color: cssVar.colorTextTertiary,
  },
  state: {
    paddingBlock: '48px',
    paddingInline: '24px',
    maxWidth: '520px',
    width: '100%',
  },
});

const ContactCard = memo<Extract<ContactCardState, { status: 'ready' }>>(
  ({ canEdit, chatUrl, item, profileUrl, role, slug, title }) => {
    const { t } = useTranslation('common');
    const navigate = useWorkspaceAwareNavigate();
    const badge = resolveAgentBadge(item);
    const coverColor = useAgentCoverColor(item, badge.cover, !!badge.coverImage);

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
              item.type === 'group' && cardStyles.avatarRingGroup,
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
          {(role || slug) && (
            <Flexbox horizontal align={'center'} gap={8} justify={'center'}>
              {role && (
                <span className={cardStyles.role} title={role}>
                  {role}
                </span>
              )}
              {slug && <span {...stylex.props(styles.slug)}>@{slug}</span>}
            </Flexbox>
          )}
          {item.description ? (
            <span {...stylex.props(styles.description)}>{item.description}</span>
          ) : (
            <span {...stylex.props(styles.placeholder)}>{t('contacts.noDescription')}</span>
          )}
          <Flexbox horizontal gap={8} justify={'center'} style={{ marginBlockStart: 16 }}>
            <Button icon={MessageCircleIcon} type={'primary'} onClick={() => navigate(chatUrl)}>
              {t('contacts.sendMessage')}
            </Button>
            {canEdit && (
              <Button icon={PencilLineIcon} onClick={() => navigate(profileUrl)}>
                {t('contacts.editProfile')}
              </Button>
            )}
          </Flexbox>
          {/* Groups own no addresses; only agents carry contact info. */}
          {item.type !== 'group' && <ContactInfo agentId={item.id} />}
        </Flexbox>
      </>
    );
  },
);

ContactCard.displayName = 'ContactCard';

/**
 * A contact's card beside the Contacts list: the agents-wall badge widened into
 * a profile header, with "Send message" into its chat and, for editors, "Edit
 * profile". Opening a contact only previews it — the chat and the edit surface
 * are one click on.
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
