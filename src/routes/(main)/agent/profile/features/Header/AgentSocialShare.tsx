'use client';

import { ActionIcon, Popover } from '@lobehub/ui';
import { MegaphoneIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { AGENTS_OFFICIAL_URL } from '@/const/url';
import SocialShare from '@/features/SocialShare';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { useAgentMarketTags } from './useAgentMarketTags';

/**
 * The public link of an agent is its Community page. Only a published listing
 * has one: an unpublished, archived or deprecated listing would 404 for the
 * people the post reaches.
 */
export const getAgentPublicUrl = (
  marketIdentifier: string | undefined,
  status: string | null,
): string | undefined =>
  marketIdentifier && status === 'published'
    ? urlJoin(AGENTS_OFFICIAL_URL, marketIdentifier)
    : undefined;

/** Header entry that posts the current agent's public Marketplace page to social media. */
const AgentSocialShare = memo(() => {
  const { t } = useTranslation('chat');
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const meta = useAgentStore(agentSelectors.currentAgentMeta);
  const { status } = useAgentMarketTags();

  const shareUrl = getAgentPublicUrl(meta?.marketIdentifier, status);

  return (
    <Popover
      arrow={false}
      open={open}
      placement={isMobile ? 'top' : 'bottomRight'}
      styles={{ content: { padding: 0, width: isMobile ? '100vw' : 340 } }}
      trigger={['click']}
      content={
        <SocialShare
          description={meta?.description || t('shareModal.social.agent.description')}
          disabledHint={t('shareModal.social.agent.disabledHint')}
          shareUrl={shareUrl}
          style={{ padding: 12 }}
          title={meta?.title || t('shareModal.social.agent.untitled')}
          onLeave={() => setOpen(false)}
        />
      }
      onOpenChange={setOpen}
    >
      <ActionIcon
        icon={MegaphoneIcon}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
        title={t('shareModal.social.agent.entry')}
        tooltipProps={{ placement: 'bottom' }}
      />
    </Popover>
  );
});

AgentSocialShare.displayName = 'AgentSocialShare';

export default AgentSocialShare;
