import { cx, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useParams } from 'react-router';

import { extractUuid } from '@/features/Acceptance/utils';
import {
  AcceptanceBundleGate,
  AcceptanceScope,
  useAcceptanceScope,
} from '@/features/Acceptance/Viewer/AcceptanceScope';
import { countDiscussionMessages } from '@/features/Acceptance/Viewer/Comments/discussionTimeline';
import { groupCommentThreads } from '@/features/Acceptance/Viewer/Comments/threads';
import { useAcceptanceCommentList } from '@/features/Acceptance/Viewer/Comments/useAcceptanceCommentList';
import AcceptanceResources from '@/features/Acceptance/Viewer/Evidence/AcceptanceResources';
import AcceptanceGoal from '@/features/Acceptance/Viewer/Header/AcceptanceGoal';
import AcceptanceIdentity from '@/features/Acceptance/Viewer/Header/AcceptanceIdentity';
import AcceptanceTabs, {
  type AcceptanceTabKey,
} from '@/features/Acceptance/Viewer/Header/AcceptanceTabs';
import ReadChecks from '@/features/Acceptance/Viewer/ReadOnly/Checks';
import ReadDiscussion from '@/features/Acceptance/Viewer/ReadOnly/Discussion';
import { useAcceptanceBundle } from '@/features/Acceptance/Viewer/useAcceptanceBundle';

import titleStyles from './AcceptanceEmbed.module.css';

const styles = stylex.create({
  content: {
    width: '100%',
    maxWidth: '1040px',
    marginInline: 'auto',
    paddingBlock: { 'default': '24px', '@media (width <= 767px)': '16px' },
    paddingInline: { 'default': '24px', '@media (width <= 767px)': '16px' },
  },
  page: {
    overflow: 'auto',
    width: '100%',
    height: '100dvh',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

const EmbedContent = () => {
  const { acceptanceId } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  const { data: discussion } = useAcceptanceCommentList(acceptanceId);
  const [tab, setTab] = useState<AcceptanceTabKey>('checks');
  const resources = new Set(
    data?.checks.flatMap((check) =>
      check.evidence
        .filter((item) => item.fileUrl || item.documentId)
        .map((item) => item.fileId ?? item.documentId ?? item.id),
    ),
  );

  return (
    <Flexbox className={cx(stylex.props(styles.content).className, titleStyles.content)} gap={24}>
      <AcceptanceIdentity />
      <AcceptanceGoal />
      <AcceptanceTabs
        active={tab}
        checkCount={data?.checks.length ?? 0}
        resourceCount={resources.size}
        discussionCount={countDiscussionMessages({
          approvals: [],
          items: discussion?.items ?? [],
          rounds: data?.rounds.map(({ run }) => run) ?? [],
          threads: groupCommentThreads(discussion?.items ?? []),
        })}
        onChange={setTab}
      />
      {/* Keep read capabilities mounted so tab and appearance changes preserve disclosure state. */}
      <div hidden={tab !== 'checks'}>
        <ReadChecks />
      </div>
      <div hidden={tab !== 'discussion'}>
        <ReadDiscussion />
      </div>
      <div hidden={tab !== 'resources'}>
        <AcceptanceResources />
      </div>
    </Flexbox>
  );
};

/** The public embed imports only reading capabilities, even when its viewer is the owner. */
const AcceptanceEmbed = () => {
  const { acceptanceId: param } = useParams<{ acceptanceId: string }>();
  const acceptanceId = extractUuid(param);
  if (!acceptanceId) return null;

  return (
    <AcceptanceScope embedded acceptanceId={acceptanceId} key={acceptanceId}>
      <div data-acceptance-embed {...stylex.props(styles.page)}>
        <AcceptanceBundleGate>
          <EmbedContent />
        </AcceptanceBundleGate>
      </div>
    </AcceptanceScope>
  );
};

export default AcceptanceEmbed;
