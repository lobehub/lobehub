'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useState } from 'react';
import { useParams } from 'react-router';

import { extractUuid } from '../utils';
import AcceptanceCheckInventory from './AcceptanceCheckInventory';
import AcceptanceCheckOwnerToolbar from './AcceptanceCheckOwnerToolbar';
import AcceptanceDecision from './AcceptanceDecision';
import AcceptanceEnterFocus from './AcceptanceEnterFocus';
import AcceptanceFocusWorkspace from './AcceptanceFocusWorkspace';
import AcceptanceGoal from './AcceptanceGoal';
import AcceptanceGoalEdit from './AcceptanceGoalEdit';
import AcceptanceIdentity from './AcceptanceIdentity';
import AcceptanceLedgerRail from './AcceptanceLedgerRail';
import AcceptanceOriginTopic from './AcceptanceOriginTopic';
import AcceptanceResources from './AcceptanceResources';
import { AcceptanceBundleGate, AcceptanceScope, useAcceptanceScope } from './AcceptanceScope';
import AcceptanceSharedNotice from './AcceptanceSharedNotice';
import AcceptanceStatusControl from './AcceptanceStatusControl';
import type { AcceptanceTabKey } from './AcceptanceTabs';
import AcceptanceTabs from './AcceptanceTabs';
import { acceptanceScrollLayout } from './layout';
import { useAcceptanceBundle } from './useAcceptanceBundle';

const CONTENT_MAX_WIDTH = 920;

const styles = createStaticStyles(({ css }) => ({
  column: css`
    width: 100%;
    max-width: ${CONTENT_MAX_WIDTH}px;
    margin-inline: auto;
    padding-inline: 24px;
  `,
  contentFrame: css`
    overflow: ${acceptanceScrollLayout.frameOverflow};
  `,
  /* Spans the frame, not the reading column — the rule is the page's own
     horizon line, so cutting it at 920 would read as a card edge. */
  headerBand: css`
    flex: none;
    padding-block: 20px 0;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  page: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    height: 100%;

    background: ${cssVar.colorBgContainer};
  `,
}));

interface AcceptancePageProps {
  acceptanceId?: string;
  onDraftToComposer?: (text: string) => boolean;
}

/**
 * The record's own body: an identity band that ends in the full-width rule,
 * then whichever face of the delivery the tabs select.
 */
const AcceptanceBody = ({ onDraftToComposer }: Pick<AcceptancePageProps, 'onDraftToComposer'>) => {
  const { acceptanceId } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  const [tab, setTab] = useState<AcceptanceTabKey>('checks');

  const resourceCount = new Set(
    (data?.checks ?? []).flatMap((check) =>
      (check.evidence ?? [])
        .filter((evidence) => evidence.fileUrl || evidence.documentId)
        .map((evidence) => evidence.fileId ?? evidence.documentId ?? evidence.id),
    ),
  ).size;

  return (
    <>
      <Flexbox className={styles.headerBand}>
        <Flexbox className={styles.column} gap={12}>
          <AcceptanceSharedNotice />
          <AcceptanceIdentity
            focusSlot={<AcceptanceEnterFocus />}
            statusSlot={<AcceptanceStatusControl />}
            topicSlot={<AcceptanceOriginTopic />}
          />
          <AcceptanceGoal editSlot={<AcceptanceGoalEdit />} />
          {/* The requirement needs room to land before the tabs start a new
              thought — at the band's uniform gap it read as another row of
              the same list. */}
          <Flexbox style={{ paddingBlockStart: 16 }}>
            <AcceptanceTabs
              active={tab}
              checkCount={data?.checks.length ?? 0}
              resourceCount={resourceCount}
              onChange={setTab}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>

      <Flexbox className={styles.column} gap={16} paddingBlock={20}>
        {tab === 'checks' ? (
          <>
            <AcceptanceCheckInventory toolbar={<AcceptanceCheckOwnerToolbar />} />
            <AcceptanceDecision onDraftToComposer={onDraftToComposer} />
          </>
        ) : (
          <AcceptanceResources />
        )}
      </Flexbox>
    </>
  );
};

const AcceptancePage = ({
  acceptanceId: explicitAcceptanceId,
  onDraftToComposer,
}: AcceptancePageProps) => {
  const params = useParams<{ acceptanceId: string; checkId: string }>();
  const acceptanceId = explicitAcceptanceId ?? extractUuid(params.acceptanceId);
  const embedded = Boolean(explicitAcceptanceId);
  const focused = !embedded && Boolean(params.checkId);

  if (!acceptanceId) return null;

  return (
    <AcceptanceScope acceptanceId={acceptanceId} embedded={embedded}>
      <AcceptanceBundleGate>
        <Flexbox horizontal className={styles.page}>
          <Flexbox className={styles.contentFrame} flex={1} style={{ minWidth: 0 }}>
            <Flexbox
              flex={focused ? 1 : undefined}
              gap={16}
              style={{ minHeight: focused ? 0 : undefined, width: '100%' }}
            >
              {focused ? (
                <>
                  {/* The focused branch zeroes the frame padding, so the
                      notice carries its own margins. A shared viewer needs
                      the capability explanation here MOST — this is where
                      the owner-only review controls are visibly absent. */}
                  <AcceptanceSharedNotice
                    style={{ marginBlockStart: 16, marginInline: 20, width: 'auto' }}
                  />
                  <AcceptanceFocusWorkspace />
                </>
              ) : null}
            </Flexbox>
            {!focused && <AcceptanceBody onDraftToComposer={onDraftToComposer} />}
          </Flexbox>
          <AcceptanceLedgerRail />
        </Flexbox>
      </AcceptanceBundleGate>
    </AcceptanceScope>
  );
};

export default AcceptancePage;
