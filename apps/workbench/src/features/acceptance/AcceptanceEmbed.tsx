import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useState } from 'react';
import { useParams } from 'react-router';

import { extractUuid } from '@/features/Acceptance/utils';
import {
  AcceptanceBundleGate,
  AcceptanceScope,
  useAcceptanceScope,
} from '@/features/Acceptance/Viewer/AcceptanceScope';
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

const styles = createStaticStyles(({ css }) => ({
  page: css`
    overflow: auto;
    width: 100%;
    height: 100dvh;
    background: ${cssVar.colorBgContainer};
  `,
  content: css`
    width: 100%;
    max-width: 1040px;
    margin-inline: auto;
    padding: 24px;

    h1 {
      overflow: visible;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    @media (width <= 767px) {
      padding: 16px;
    }
  `,
}));

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
    <Flexbox className={styles.content} gap={24}>
      <AcceptanceIdentity />
      <AcceptanceGoal />
      <AcceptanceTabs
        active={tab}
        checkCount={data?.checks.length ?? 0}
        resourceCount={resources.size}
        discussionCount={
          groupCommentThreads(discussion?.items ?? []).filter(({ root }) => !root.checkItemId)
            .length
        }
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
      <div data-acceptance-embed className={styles.page}>
        <AcceptanceBundleGate>
          <EmbedContent />
        </AcceptanceBundleGate>
      </div>
    </AcceptanceScope>
  );
};

export default AcceptanceEmbed;
