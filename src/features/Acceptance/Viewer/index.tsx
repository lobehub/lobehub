'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useParams } from 'react-router';

import { sx } from '@/styles/sx';

import { extractUuid } from '../utils';
import { AcceptanceOverview } from './AcceptanceOverview';
import { AcceptanceBundleGate, AcceptanceScope } from './AcceptanceScope';
import CollaboratorConversationRail from './Conversation/CollaboratorConversationRail';
import { FlowPanelHostContext } from './Flow/FlowPanelHost';
import AcceptanceFocusWorkspace from './Focus/AcceptanceFocusWorkspace';
import AcceptanceLedgerRail from './History/AcceptanceLedgerRail';

const phone = '@media (width <= 767px)';

// `overflow` repeats acceptanceScrollLayout.frameOverflow ('auto') from ./layout:
// StyleX cannot read constants from another module.
const styles = stylex.create({
  contentFrame: {
    overflow: 'auto',
  },
  flowPanel: {
    flex: 'none',
    width: { default: 'min(440px, 42%)', [phone]: '100%' },
    height: { default: '100%', [phone]: '50%' },
    minHeight: 0,
    display: { 'default': null, ':empty': 'none' },
    borderBlockStartWidth: { default: null, [phone]: '1px' },
    borderBlockStartStyle: { default: null, [phone]: 'solid' },
    borderBlockStartColor: { default: null, [phone]: cssVar.colorBorderSecondary },
  },
  page: {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    height: '100%',
    backgroundColor: cssVar.colorBgContainer,
    flexDirection: { default: null, [phone]: 'column' },
  },
});

interface AcceptancePageProps {
  acceptanceId?: string;
  onDraftToComposer?: (text: string) => boolean;
}

const AcceptancePage = ({
  acceptanceId: explicitAcceptanceId,
  onDraftToComposer,
}: AcceptancePageProps) => {
  const params = useParams<{ acceptanceId: string; checkId: string }>();
  const acceptanceId = explicitAcceptanceId ?? extractUuid(params.acceptanceId);
  const [flowPanelHost, setFlowPanelHostContext] = useState<HTMLDivElement | null>(null);
  const embedded = Boolean(explicitAcceptanceId);
  const focused = !embedded && Boolean(params.checkId);

  if (!acceptanceId) return null;

  return (
    <AcceptanceScope acceptanceId={acceptanceId} embedded={embedded}>
      <AcceptanceBundleGate>
        <FlowPanelHostContext value={flowPanelHost}>
          <Flexbox horizontal {...stylex.props(styles.page)}>
            <Flexbox
              horizontal
              flex={1}
              style={{ minHeight: 0, minWidth: 0, position: 'relative' }}
            >
              <Flexbox flex={1} {...sx([styles.contentFrame], undefined, { minWidth: 0 })}>
                <Flexbox
                  flex={focused ? 1 : undefined}
                  gap={16}
                  style={{ minHeight: focused ? 0 : undefined, width: '100%' }}
                >
                  {focused ? <AcceptanceFocusWorkspace /> : null}
                </Flexbox>
                {!focused && <AcceptanceOverview onDraftToComposer={onDraftToComposer} />}
              </Flexbox>
              <AcceptanceLedgerRail />
              {!embedded && <CollaboratorConversationRail />}
            </Flexbox>
            <div ref={setFlowPanelHostContext} {...stylex.props(styles.flowPanel)} />
          </Flexbox>
        </FlowPanelHostContext>
      </AcceptanceBundleGate>
    </AcceptanceScope>
  );
};

export default AcceptancePage;
