import { parsePullRequestUrl } from '@lobechat/utils/githubPullRequest';

import { EntityLinkElement } from '@/features/EntityLink';
import type { EntityLinkElementProps } from '@/features/EntityLink/types';

import { PullRequestLinkToolbar } from './PullRequestLinkToolbar';

export const ConversationLink = (props: EntityLinkElementProps) => {
  const { linkHref, linkKind } = props.node?.properties ?? {};
  const pullRequest = linkKind === 'github' && linkHref ? parsePullRequestUrl(linkHref) : null;
  const link = <EntityLinkElement.Component {...props} />;

  return pullRequest ? (
    <PullRequestLinkToolbar identifier={pullRequest.identifier} url={pullRequest.url}>
      {link}
    </PullRequestLinkToolbar>
  ) : (
    link
  );
};
