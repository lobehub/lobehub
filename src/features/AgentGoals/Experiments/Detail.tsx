import type { GoalGraphSnapshot } from '@lobechat/types';
import { Flexbox, Markdown } from '@lobehub/ui';
import { Accordion, Button, Tag, Text } from '@lobehub/ui/base-ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';

import {
  type GoalGraphView,
  type GoalNodeView,
  hasReviewableResult,
} from '../ProcessControl/goalGraphViewModel';
import { experimentInputs, experimentRelations } from './model';

export const ExperimentDetail = ({
  graph,
  view,
  snapshot,
  children,
}: {
  graph: GoalGraphView;
  view: GoalNodeView;
  snapshot: GoalGraphSnapshot;
  children: ReactNode;
}) => {
  const { t } = useTranslation('chat');
  const openNode = useChatStore((s) => s.drillIntoGoalNode);
  const openTask = useChatStore((s) => s.openTaskDetail);
  const openResult = useChatStore((s) => s.openTaskResult);
  const openAcceptance = useChatStore((s) => s.openAcceptance);
  const relations = experimentRelations(graph, view.node.id);
  const inputs = experimentInputs(snapshot, view.node.id);
  return (
    <Flexbox flex={1} style={{ minHeight: 0 }}>
      <Flexbox gap={10} padding={16} style={{ flexShrink: 0 }}>
        <Flexbox horizontal gap={8} wrap={'wrap'}>
          <Tag>{t('goalExperiment.number', { number: view.seq })}</Tag>
          <Tag>
            {t(
              view.isVerifying
                ? 'goalProcess.tag.verifying'
                : `goalProcess.nodeStatus.${view.node.status}`,
            )}
          </Tag>
        </Flexbox>
        <Text as={'h2'} fontSize={18} weight={600}>
          {view.node.title}
        </Text>
        <Flexbox horizontal gap={8} wrap={'wrap'}>
          {view.node.taskId && (
            <Button size={'small'} onClick={() => openTask(view.node.taskId!)}>
              {t('goalExperiment.execution')}
            </Button>
          )}
          {view.node.taskId && hasReviewableResult(view) && (
            <Button size={'small'} onClick={() => openResult(view.node.taskId!)}>
              {t('goalExperiment.delivery')}
            </Button>
          )}
          {view.acceptance && (
            <Button size={'small'} onClick={() => openAcceptance(view.acceptance!.id)}>
              {t('goalExperiment.acceptance')}
            </Button>
          )}
        </Flexbox>
      </Flexbox>
      <Flexbox gap={20} padding={16} style={{ minHeight: 0, overflowY: 'auto' }}>
        <Flexbox gap={8} style={{ flexShrink: 0 }}>
          <Text weight={600}>{t('goalExperiment.result')}</Text>
          {view.findings.length === 0 && (
            <Text type={'secondary'}>{t('goalExperiment.noResult')}</Text>
          )}
          {view.findings.map((finding) => (
            <Flexbox gap={6} key={finding.id}>
              <Text weight={500}>{finding.title}</Text>
              {finding.description && (
                <Markdown fontSize={13} style={{ flexShrink: 0 }} variant={'chat'}>
                  {finding.description}
                </Markdown>
              )}
            </Flexbox>
          ))}
        </Flexbox>
        <Flexbox gap={8} style={{ flexShrink: 0 }}>
          <Text weight={600}>{t('goalExperiment.lineage')}</Text>
          {relations.parents.length === 0 && (
            <Text type={'secondary'}>{t('goalExperiment.baseline')}</Text>
          )}
          {(['parents', 'children'] as const).map((kind) =>
            relations[kind].map((relative) => (
              <Button
                key={`${kind}:${relative.node.id}`}
                size={'small'}
                style={{
                  height: 'auto',
                  minHeight: 32,
                  paddingBlock: 6,
                  whiteSpace: 'normal',
                  justifyContent: 'flex-start',
                  textAlign: 'start',
                }}
                onClick={() => openNode(graph.goal.id, relative.node.id)}
              >
                {t(kind === 'parents' ? 'goalExperiment.parentLink' : 'goalExperiment.childLink', {
                  number: relative.seq,
                  title: relative.node.title,
                })}
              </Button>
            )),
          )}
        </Flexbox>
        <Accordion
          defaultValue={['instruction']}
          style={{ flexShrink: 0 }}
          items={[
            {
              children: (
                <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {view.node.description ?? view.node.title}
                </Text>
              ),
              key: 'instruction',
              title: t('goalExperiment.instruction'),
            },
            {
              children: (
                <Flexbox gap={8}>
                  <Text fontSize={12} type={'secondary'}>
                    {t('goalExperiment.inputHint')}
                  </Text>
                  {inputs.map((input) => (
                    <Flexbox gap={4} key={input.workVersionId}>
                      <Text>{input.work?.title ?? t('goalExperiment.unavailableInput')}</Text>
                      <Text fontSize={12} style={{ overflowWrap: 'anywhere' }} type={'secondary'}>
                        {input.workVersionId}
                      </Text>
                    </Flexbox>
                  ))}
                </Flexbox>
              ),
              key: 'inputs',
              title: t('goalExperiment.inputs', { count: inputs.length }),
            },
          ]}
        />
        {children}
      </Flexbox>
    </Flexbox>
  );
};
