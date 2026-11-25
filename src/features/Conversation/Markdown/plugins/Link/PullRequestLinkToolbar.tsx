import { Button, Popover } from '@lobehub/ui';
import { Link2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '../../../store';
import { usePullRequestLink } from './usePullRequestLink';

interface PullRequestLinkToolbarProps {
  children: ReactNode;
  identifier: string;
  url: string;
}

const Toolbar = ({
  children,
  identifier,
  topicId,
  url,
}: PullRequestLinkToolbarProps & { topicId: string }) => {
  const { t } = useTranslation('chat');
  const { canLink, link, linking } = usePullRequestLink(topicId, identifier, url);
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={canLink && open}
      placement={'topLeft'}
      popupProps={{ initialFocus: false }}
      styles={{ content: { padding: 4 } }}
      trigger={'hover'}
      triggerProps={{ role: undefined, tabIndex: undefined }}
      content={
        canLink ? (
          <Button
            icon={Link2}
            loading={linking}
            size={'small'}
            type={'text'}
            onClick={(event) => {
              event.stopPropagation();
              void link();
            }}
          >
            {t('workingPanel.overview.pr.linkAction')}
          </Button>
        ) : null
      }
      onOpenChange={setOpen}
    >
      <span
        onFocus={(event) => {
          if (canLink && event.target.matches(':focus-visible')) setOpen(true);
        }}
      >
        {children}
      </span>
    </Popover>
  );
};

export const PullRequestLinkToolbar = (props: PullRequestLinkToolbarProps) => {
  const topicId = useConversationStore(({ context, skipFetch }) =>
    skipFetch || context.topicShareId || context.agentShareId ? undefined : context.topicId,
  );

  if (!topicId) return props.children;

  return <Toolbar key={`${topicId}:${props.identifier}`} {...props} topicId={topicId} />;
};
