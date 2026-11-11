'use client';

import { AGENT_CHAT_URL, AGENT_PROFILE_URL, GROUP_CHAT_URL } from '@lobechat/const';
import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import { Button, Center, Empty, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { MessageCircleIcon, PencilLineIcon, UserRoundXIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import NavHeader from '@/features/NavHeader';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { usePermission } from '@/hooks/usePermission';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import ContactAvatar from './ContactAvatar';

const AVATAR_SIZE = 80;

const styles = stylex.create({
  card: {
    paddingBlock: '48px',
    paddingInline: '24px',
    maxWidth: '480px',
    width: '100%',
    textAlign: 'center',
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
  role: {
    overflow: 'hidden',
    fontSize: '13px',
    color: cssVar.colorTextTertiary,
    maxWidth: '100%',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

/**
 * A contact's card beside the Contacts list: who the agent or group is, with
 * "Send message" into its chat and, for editors, "Edit profile". Opening a
 * contact only previews it — the chat and the edit surface are one click on.
 */
const ContactDetail = memo<{ id: string }>(({ id }) => {
  const { t } = useTranslation('common');
  const { t: tChat } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const { error, mutate } = useFetchAgentList();
  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const item = useHomeStore(homeAgentListSelectors.getAgentById(id), isEqual);
  const isGroup = item?.type === 'group';

  const { allowed: canEditContent } = usePermission('edit_own_content');
  const { canEditResource } = useResourceAccess(
    isGroup ? 'agentGroup' : 'agent',
    item ? id : undefined,
  );

  if (!item) {
    // Mobile has no Contacts list beside the card to surface a failed load,
    // so the card owns the retry instead of waiting on a skeleton forever.
    if (!isInit && error)
      return (
        <Flexbox align={'center'} {...stylex.props(styles.card)}>
          <AsyncError error={error} variant="inline" onRetry={() => void mutate()} />
        </Flexbox>
      );

    if (!isInit)
      return (
        <Flexbox align={'center'} gap={12} {...stylex.props(styles.card)}>
          <Skeleton.Avatar shape={'square'} size={AVATAR_SIZE} />
          <Skeleton height={28} width={160} />
          <Skeleton.Text rows={2} width={['100%', '60%']} />
        </Flexbox>
      );

    return (
      <Flexbox align={'center'} {...stylex.props(styles.card)}>
        <Empty description={t('contacts.notFound')} icon={UserRoundXIcon} />
      </Flexbox>
    );
  }

  const title = isGroup
    ? item.title || tChat('untitledAgent')
    : agentDisplayName(item, tChat('untitledAgent'));
  const roleLine = isGroup
    ? undefined
    : [agentSecondaryDisplayName(item), item.slug ? `@${item.slug}` : undefined]
        .filter(Boolean)
        .join(' · ');

  return (
    <Flexbox align={'center'} gap={12} {...stylex.props(styles.card)}>
      <ContactAvatar item={item} name={title} size={AVATAR_SIZE} />
      <Text ellipsis as={'h1'} fontSize={22} style={{ margin: 0, maxWidth: '100%' }} weight={600}>
        {title}
      </Text>
      {roleLine && <span {...stylex.props(styles.role)}>{roleLine}</span>}
      {item.description ? (
        <span {...stylex.props(styles.description)}>{item.description}</span>
      ) : (
        <span {...stylex.props(styles.placeholder)}>{t('contacts.noDescription')}</span>
      )}
      <Flexbox horizontal gap={8} justify={'center'} style={{ marginBlockStart: 12 }}>
        <Button
          icon={MessageCircleIcon}
          type={'primary'}
          onClick={() => navigate(isGroup ? GROUP_CHAT_URL(id) : AGENT_CHAT_URL(id))}
        >
          {t('contacts.sendMessage')}
        </Button>
        {canEditContent && canEditResource && (
          <Button
            icon={PencilLineIcon}
            onClick={() => navigate(isGroup ? `/group/${id}/profile` : AGENT_PROFILE_URL(id))}
          >
            {t('contacts.editProfile')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
});

ContactDetail.displayName = 'ContactDetail';

export { ContactDetail };

/** `/agents/:id`: the contact card in the content column of the Contacts tab. */
const ContactDetailPage = () => {
  const { id } = useParams<{ id: string }>();

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader />
      <Center flex={1} style={{ overflowY: 'auto' }}>
        {id && <ContactDetail id={id} key={id} />}
      </Center>
    </Flexbox>
  );
};

export default ContactDetailPage;
