'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
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
import { AcceptanceBundleGate, AcceptanceScope } from './AcceptanceScope';
import AcceptanceStatusControl from './AcceptanceStatusControl';
import AcceptanceViewReportLink from './AcceptanceViewReportLink';
import { acceptanceScrollLayout } from './layout';

const styles = createStaticStyles(({ css }) => ({
  contentFrame: css`
    overflow: ${acceptanceScrollLayout.frameOverflow};
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
}

const AcceptancePage = ({ acceptanceId: explicitAcceptanceId }: AcceptancePageProps) => {
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
              paddingBlock={focused ? 0 : 20}
              paddingInline={focused ? 0 : 24}
              style={{
                margin: focused ? 0 : '0 auto',
                maxWidth: focused ? 'none' : 920,
                minHeight: focused ? 0 : undefined,
                width: '100%',
              }}
            >
              {focused ? (
                <AcceptanceFocusWorkspace />
              ) : (
                <>
                  <AcceptanceIdentity
                    statusSlot={<AcceptanceStatusControl />}
                    topicSlot={<AcceptanceOriginTopic />}
                  />
                  <AcceptanceEnterFocus />
                  <AcceptanceGoal
                    editSlot={<AcceptanceGoalEdit />}
                    reportSlot={<AcceptanceViewReportLink />}
                  />
                  <AcceptanceCheckInventory toolbar={<AcceptanceCheckOwnerToolbar />} />
                  <AcceptanceDecision />
                </>
              )}
            </Flexbox>
          </Flexbox>
          <AcceptanceLedgerRail />
        </Flexbox>
      </AcceptanceBundleGate>
    </AcceptanceScope>
  );
};

export default AcceptancePage;
