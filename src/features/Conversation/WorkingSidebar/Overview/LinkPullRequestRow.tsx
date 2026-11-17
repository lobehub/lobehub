import { LinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { openLinkPullRequestModal } from './LinkPullRequestModal';
import { OverviewRow } from './OverviewRow';

interface LinkPullRequestRowProps {
  /** Resolves to the linked `owner/repo#n`. */
  onLink: (url: string) => Promise<string | undefined>;
}

/** Better Coding Experience: the repository card's "Link a pull request" action. */
export const LinkPullRequestRow = memo<LinkPullRequestRowProps>(({ onLink }) => {
  const { t } = useTranslation('chat');

  return (
    <OverviewRow
      weak
      icon={LinkIcon}
      iconSize={14}
      value={t('workingPanel.overview.pr.link')}
      onClick={() => openLinkPullRequestModal(onLink)}
    />
  );
});

LinkPullRequestRow.displayName = 'OverviewLinkPullRequestRow';
