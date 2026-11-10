'use client';

import '@xyflow/react/dist/style.css';

import { experimentMembers } from '@lobechat/utils/goalGraph';
import { ActionIcon, Button, cx, Flexbox, Segmented, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ReactFlowProvider } from '@xyflow/react';
import { ChevronRight, Maximize2, X } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type GoalGraphNodeKind, isContainerKind } from '../../Experiments/model';
import { type GoalGraphView, scopeGraphView } from '../goalGraphViewModel';
import { type BatchModel, buildBatchModel } from './batchModel';
import { batchStageId, batchStages } from './batchScopeLayout';
import { Canvas } from './Canvas';
import canvasStyles from './canvas.module.css';
import GraphLegend from './GraphLegend';
import type { GraphProps } from './graphTypes';
import { resolveMainline } from './mainline';
import { useExplorationNavigation } from './useExplorationNavigation';
import { type GraphViewMode, isStageWholeMap } from './viewMode';

/**
 * The exploration map. Two views: 当前阶段 (what got the goal here plus what the
 * next advance unlocks) and 全图. Edges carry their relation as a label so the
 * map reads without a legend; the legend itself is a kind filter — click 任务
 * or 结论 off and the map relayouts around what remains. Fullscreen is a real
 * overlay, not a taller box, and carries its own right-hand portal panel so
 * node drill-down keeps working.
 */

const styles = stylex.create({
  /* Fullscreen chrome floats over the canvas in two corner cards instead of a
     full-width bar, so a node panned to the top edge is never hidden behind an
     opaque header strip. */
  float: {
    alignItems: 'center',
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: cssVar.boxShadowTertiary,
    display: 'flex',
    gap: 12,
    insetBlockStart: 16,
    paddingBlock: 8,
    paddingInline: 14,
    position: 'absolute',
    zIndex: 1,
  },
  floatRight: {
    insetInlineEnd: 16,
  },
  overlay: {
    backgroundColor: cssVar.colorBgLayout,
    display: 'flex',
    flexDirection: 'row',
    insetBlock: 0,
    insetInline: 0,
    position: 'fixed',
    zIndex: 1000,
  },
  /* The corner cards anchor to the canvas area, not the whole overlay, so the
     portal panel opening on the right never slides under them. */
  overlayMain: {
    flex: '1',
    height: '100%',
    minWidth: 0,
    position: 'relative',
  },
});

const ExplorationGraph = memo<GraphProps>(
  ({
    extra,
    fullscreen = false,
    fullscreenAside,
    onFullscreenChange,
    onInspect,
    refitKey,
    ...props
  }) => {
    const { t } = useTranslation('chat');
    const shape = useMemo(
      () => ({ edges: props.graph.edges, nodes: props.graph.nodes.map((item) => item.node) }),
      [props.graph],
    );
    // A batch is entered one stage at a time — its cold start, or one round —
    // so each stage is a scope of its own, read off the whole graph.
    const batchStageScopes = useMemo(() => {
      const result = new Map<
        string,
        { members: Set<string>; model: BatchModel; revision: number }
      >();
      for (const item of props.graph.nodes) {
        if (item.node.kind !== 'batch') continue;
        const model = buildBatchModel(props.graph, item.node.id);
        const members = experimentMembers(shape, item.node.id);
        for (const stage of batchStages(props.graph, model, members))
          result.set(batchStageId(item.node.id, stage.revision), {
            members: new Set([...stage.headers, ...stage.units]),
            model,
            revision: stage.revision,
          });
      }
      return result;
    }, [props.graph, shape]);
    const navigation = useExplorationNavigation(
      props.graph.goal.id,
      shape,
      (id) => batchStageScopes.get(id)?.members,
    );
    const { collapsed, scopeId } = navigation;
    const scopeIds = new Set(navigation.nodes.map((node) => node.id));
    const scopedGraph: GoalGraphView = scopeId
      ? scopeGraphView(props.graph, scopeIds, navigation.edges)
      : props.graph;
    const scopeStage = scopeId ? batchStageScopes.get(scopeId) : undefined;
    const scopeBatch = scopeStage?.model;
    const stageLabel = (revision: number) =>
      revision ? t('goalBatch.round.title', { revision }) : t('goalBatch.probes.title');
    const scopeLabel = (id: string) => {
      const stage = batchStageScopes.get(id);
      return stage ? stageLabel(stage.revision) : props.graph.byId[id]?.node.title;
    };
    const [preferredView, setView] = useState<GraphViewMode>('stage');
    const stageIsWholeMap = isStageWholeMap(props.graph);
    const view: GraphViewMode = stageIsWholeMap ? 'all' : preferredView;
    const containers = props.graph.nodes.filter((item) => isContainerKind(item.node.kind));
    const onlyBatches = containers.every((item) => item.node.kind === 'batch');
    // A batch never folds, so expand/collapse all only means something with experiments.
    const hasFoldable = !onlyBatches;
    const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<GoalGraphNodeKind>>(() => new Set());
    const [showMainline, setShowMainline] = useState(props.initialShowMainline ?? false);

    const toggleKind = useCallback((kind: GoalGraphNodeKind) => {
      setHiddenKinds((prev) => {
        const next = new Set(prev);
        if (next.has(kind)) next.delete(kind);
        else next.add(kind);
        return next;
      });
    }, []);

    const toggleMainline = useCallback(() => setShowMainline((prev) => !prev), []);

    const selectNode = (nodeId: string) => {
      if (isContainerKind(props.graph.byId[nodeId]?.node.kind ?? ('task' as const))) {
        navigation.toggle(nodeId);
      } else props.onSelect(nodeId);
    };
    const overview = containers.length > 0 && (
      <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
        <Text fontSize={12} type={'secondary'}>
          {t(onlyBatches ? 'goalBatch.overviewCount' : 'goalExperiment.overviewCount', {
            count: containers.length,
            nodes: props.graph.nodes.length,
          })}
        </Text>
        {hasFoldable && (
          <>
            <Button size={'small'} onClick={() => navigation.expandAll(true)}>
              {t(scopeId ? 'goalExperiment.expandScope' : 'goalExperiment.expandAll')}
            </Button>
            <Button size={'small'} onClick={() => navigation.expandAll(false)}>
              {t(scopeId ? 'goalExperiment.collapseScope' : 'goalExperiment.collapseAll')}
            </Button>
          </>
        )}
      </Flexbox>
    );
    const breadcrumbs = scopeId && (
      <Flexbox
        horizontal
        align={'center'}
        aria-label={t('goalExperiment.location')}
        gap={4}
        role={'navigation'}
        wrap={'wrap'}
      >
        <Button size={'small'} onClick={() => navigation.backTo(0)}>
          {t('goalExperiment.root')}
        </Button>
        {navigation.path.map((id, index) => (
          <Flexbox horizontal align={'center'} gap={4} key={id}>
            <ChevronRight size={14} />
            {index === navigation.path.length - 1 ? (
              <Text aria-current={'page'} fontSize={12}>
                {scopeLabel(id)}
              </Text>
            ) : (
              <Button size={'small'} onClick={() => navigation.backTo(index + 1)}>
                {scopeLabel(id)}
              </Button>
            )}
          </Flexbox>
        ))}
      </Flexbox>
    );
    const toggle = onFullscreenChange && (
      <ActionIcon
        icon={fullscreen ? X : Maximize2}
        size={'small'}
        aria-label={
          fullscreen ? t('goalProcess.graph.exitFullscreen') : t('goalProcess.graph.fullscreen')
        }
        title={
          fullscreen ? t('goalProcess.graph.exitFullscreen') : t('goalProcess.graph.fullscreen')
        }
        onClick={() => onFullscreenChange(!fullscreen)}
      />
    );
    const titleAndViews = (
      <>
        <Text fontSize={16} weight={600}>
          {t('goalProcess.graph.title')}
        </Text>
        {containers.length === 0 && !stageIsWholeMap && (
          <Segmented
            size={'small'}
            value={view}
            options={[
              { label: t('goalProcess.graph.view.stage'), value: 'stage' },
              { label: t('goalProcess.graph.view.all'), value: 'all' },
            ]}
            onChange={(value) => setView(value as GraphViewMode)}
          />
        )}
        {/* Inline, the expand button sits with the view switch; fullscreen keeps
          its exit in the top-right corner card. */}
        {!fullscreen && toggle}
      </>
    );
    // Read against the map actually drawn — a scoped drill-down judges its own
    // cards, so the legend never promises a mainline the view decided to drop.
    const hasMainline = !!resolveMainline(scopedGraph);
    const legend = (
      <GraphLegend
        hasMainline={hasMainline}
        hiddenKinds={hiddenKinds}
        showMainline={showMainline}
        kinds={[
          'problem',
          'task',
          ...(containers.some((view) => view.node.kind === 'experiment')
            ? ['experiment' as const]
            : []),
          ...(containers.some((view) => view.node.kind === 'batch') ? ['batch' as const] : []),
          'finding',
          'decision',
        ]}
        onToggleKind={toggleKind}
        onToggleMainline={toggleMainline}
      />
    );
    if (fullscreen)
      return (
        <div {...stylex.props(styles.overlay)}>
          <div {...stylex.props(styles.overlayMain)}>
            <ReactFlowProvider>
              <Canvas
                {...props}
                fullscreen
                className={cx(canvasStyles.canvas, canvasStyles.full)}
                collapsed={collapsed}
                graph={scopedGraph}
                hiddenKinds={hiddenKinds}
                key={scopeId ?? 'root'}
                planning={scopeId ? false : props.planning}
                refitKey={refitKey}
                scopeBatch={scopeBatch}
                showMainline={showMainline}
                view={scopeId ? 'all' : view}
                navigation={
                  <Flexbox gap={8}>
                    {/* Title and view switch share one row, as in the inline header. */}
                    <Flexbox horizontal align={'center'} gap={12}>
                      {titleAndViews}
                    </Flexbox>
                    {overview}
                    {breadcrumbs}
                  </Flexbox>
                }
                onEnter={navigation.enter}
                onInspect={onInspect}
                onSelect={selectNode}
              />
            </ReactFlowProvider>
            {/* Corner cards float over the canvas — the map owns the whole screen
              and panned content stays visible between them. */}
            <div {...stylex.props(styles.float, styles.floatRight)}>
              {legend}
              {toggle}
            </div>
          </div>
          {fullscreenAside}
        </div>
      );

    return (
      <Flexbox gap={4}>
        {overview}
        <Flexbox
          horizontal
          align={'center'}
          justify={'space-between'}
          paddingBlock={4}
          wrap={'wrap'}
        >
          <Flexbox horizontal align={'center'} gap={12}>
            {titleAndViews}
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={12}>
            {legend}
            {extra}
          </Flexbox>
        </Flexbox>
        <ReactFlowProvider>
          <Canvas
            {...props}
            className={canvasStyles.canvas}
            collapsed={collapsed}
            fullscreen={false}
            graph={scopedGraph}
            hiddenKinds={hiddenKinds}
            key={scopeId ?? 'root'}
            navigation={breadcrumbs}
            planning={scopeId ? false : props.planning}
            scopeBatch={scopeBatch}
            showMainline={showMainline}
            view={scopeId ? 'all' : view}
            onEnter={navigation.enter}
            onInspect={onInspect}
            onSelect={selectNode}
          />
        </ReactFlowProvider>
      </Flexbox>
    );
  },
);

ExplorationGraph.displayName = 'GoalExplorationGraph';

export default ExplorationGraph;
