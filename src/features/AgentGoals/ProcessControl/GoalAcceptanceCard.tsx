'use client';

import { Flexbox, Icon, Markdown } from '@lobehub/ui';
import { Button, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FileText } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useAcceptanceBundle } from '@/features/Acceptance/hooks';
import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import { useChatStore } from '@/store/chat';

import {
  goalAcceptanceState,
  isFinalAcceptanceReady,
  latestRunStatus,
  pickFinalDeliverable,
} from './goalAcceptanceReport';
import type { GoalGraphView, GoalNodeView } from './goalGraphViewModel';

/**
 * The Goal's final deliverable, in place of the task list.
 *
 * Once every task ran through and the final acceptance passed, nothing is left
 * to advance: what the owner wants to read is what the Goal produced. So the
 * list gives way to that product — the document the work wrote, its title and a
 * preview of its content — and the full document opens in the side Portal, like
 * every other drill-down here. Neither the acceptance report nor the synthesized
 * finding stands in for it: both are about the product, not the product.
 *
 * Until that point (see `isFinalAcceptanceReady`), or when the Goal produced no
 * document, the list stays exactly as it was.
 */

const styles = createStaticStyles(({ css }) => ({
  document: css`
    cursor: pointer;

    display: flex;
    flex-direction: column;
    gap: 10px;

    width: 100%;
    padding-block: 16px;
    padding-inline: 18px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    text-align: start;

    background: ${cssVar.colorBgContainer};

    &:hover {
      border-color: ${cssVar.colorBorder};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  preview: css`
    overflow: hidden;
    max-height: 320px;

    mask-image: linear-gradient(to bottom, #000 75%, transparent);
  `,
}));

interface GoalFinalAcceptanceProps {
  /** The task list, shown until the Goal's final deliverable can replace it. */
  children: ReactNode;
  graph: GoalGraphView;
  /** The Goal's resolved final acceptance task, when there is one. */
  view?: GoalNodeView;
}

// The tag and the button are their own actions, not "open the document".
const stop = (event: MouseEvent) => event.stopPropagation();

const FinalDeliverable = ({
  acceptance,
  children,
  graph,
  view,
}: GoalFinalAcceptanceProps & {
  acceptance: NonNullable<GoalNodeView['acceptance']>;
  view: GoalNodeView;
}) => {
  const { t } = useTranslation('chat');
  const openAcceptance = useChatStore((s) => s.openAcceptance);
  const openDocument = useChatStore((s) => s.openDocument);

  const { data } = useAcceptanceBundle(acceptance.id);
  const state = goalAcceptanceState(acceptance.status, latestRunStatus(data?.rounds ?? []));
  const ready = !!data && isFinalAcceptanceReady(view.node.status, state);
  const deliverable = ready ? pickFinalDeliverable(graph.artifacts, view.node.id) : undefined;

  // The graph carries only the document id; its content is read for the preview.
  const { data: document } = useClientDataSWR(
    deliverable ? portalKeys.documentHeader(deliverable.documentId) : null,
    () => documentService.getDocumentById(deliverable!.documentId),
  );

  if (!deliverable) return <>{children}</>;

  const open = () => openDocument(deliverable.documentId, deliverable.agentDocumentId);
  const producer = graph.byId[deliverable.nodeId]?.node.title;

  return (
    <Flexbox gap={10}>
      <div
        className={styles.document}
        role={'button'}
        tabIndex={0}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          open();
        }}
      >
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon color={cssVar.colorTextSecondary} icon={FileText} size={16} />
          <Text ellipsis fontSize={15} style={{ flex: 1, minWidth: 0 }} weight={600}>
            {document?.title || deliverable.title || t('goalProcess.deliverables.untitled')}
          </Text>
          <Tag
            color={state === 'accepted' ? 'success' : 'warning'}
            size={'small'}
            style={{ cursor: 'pointer' }}
            onClick={(event) => {
              stop(event);
              openAcceptance(acceptance.id);
            }}
          >
            {t(
              state === 'accepted'
                ? 'goalProcess.goalAcceptance.state.accepted'
                : 'goalProcess.goalAcceptance.state.awaitingAcceptance',
            )}
          </Tag>
        </Flexbox>
        {!!producer && (
          <Text fontSize={12} type={'secondary'}>
            {t('goalProcess.deliverables.from', { title: producer })}
          </Text>
        )}
        {!!document?.content && (
          <div className={styles.preview}>
            <Markdown fontSize={13} variant={'chat'}>
              {document.content}
            </Markdown>
          </div>
        )}
        <Text fontSize={12} type={'secondary'}>
          {t('goalProcess.goalAcceptance.viewFull')}
        </Text>
      </div>
      {state === 'awaitingAcceptance' && (
        <Flexbox horizontal>
          <Button size={'small'} type={'primary'} onClick={() => openAcceptance(acceptance.id)}>
            {t('goalProcess.goalAcceptance.review')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
};

export const GoalFinalAcceptance = ({ children, graph, view }: GoalFinalAcceptanceProps) => {
  if (!view?.acceptance) return <>{children}</>;
  return (
    <FinalDeliverable acceptance={view.acceptance} graph={graph} view={view}>
      {children}
    </FinalDeliverable>
  );
};
