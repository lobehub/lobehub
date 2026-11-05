'use client';

import '@xyflow/react/dist/style.css';

import {
  ActionIcon,
  Button,
  Empty,
  Flexbox,
  Select,
  Text,
  useAppElement,
  useResponsive,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MarkerType, ReactFlowProvider } from '@xyflow/react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { use, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { useAcceptanceScope } from '../AcceptanceScope';
import { acceptanceContentLayout } from '../layout';
import { AcceptancePlanReview } from '../Plan/AcceptancePlanReview';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { FlowCanvas } from './FlowCanvas';
import { buildFlowGraph } from './flowGraph';
import { FlowGroup } from './FlowGroup';
import { getFlowRoundViews } from './flowNavigation';
import { FlowNode } from './FlowNode';
import { FlowOutline } from './FlowOutline';
import { FlowPanelHostContext } from './FlowPanelHost';
import { FlowResults } from './FlowResults';

const narrow = '@media (width <= 640px)';

// The page's text measure, from the shared layout constants StyleX cannot read.
const contentMeasure = acceptanceContentLayout.maxWidth - 2 * acceptanceContentLayout.paddingInline;

const styles = stylex.create({
  // Fullscreen is a two-column shell, the same shape the page uses: the details
  // rail owns the full height of the right edge and the toolbar belongs to the
  // canvas beside it, not to a band stretched across both.
  fullscreen: {
    position: 'fixed',
    zIndex: cssVar.zIndexPopupBase,
    insetBlockStart: 0,
    insetBlockEnd: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
    backgroundColor: cssVar.colorBgContainer,
    flexDirection: { default: null, [narrow]: 'column' },
  },
  stage: {
    minWidth: 0,
    minHeight: 0,
    padding: '16px',
  },
  details: {
    overflow: 'hidden',
    flex: 'none',
    width: { default: 'min(440px, 42%)', [narrow]: '100%' },
    height: { default: '100%', [narrow]: '40%' },
    minHeight: 0,
  },
  workspace: {
    minWidth: 0,
    minHeight: 0,
    flexDirection: { default: null, [narrow]: 'column' },
  },
  toolbar: {
    width: '100%',
    marginInline: 'auto',
  },
  // The outline is reading material, so it keeps the page's text measure while
  // the canvas next to it is allowed the full width.
  outline: {
    overflow: 'auto',
    width: '100%',
    minWidth: 0,
    marginInline: 'auto',
  },
});

const nodeTypes = { state: FlowNode, flowGroup: FlowGroup };

export function AcceptanceFlow() {
  const { t } = useTranslation('verify');
  const appElement = useAppElement();
  const panelHost = use(FlowPanelHostContext);
  const { md = true } = useResponsive();
  const [display, setDisplay] = useState<'graph' | 'outline'>();
  const showOutline = (display ?? (md ? 'graph' : 'outline')) === 'outline';
  const { acceptanceId } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!fullscreen) return;
    const focusToggle = () => fullscreenButton.current?.focus();
    focusToggle();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      requestAnimationFrame(focusToggle);
    };
  }, [fullscreen]);
  const [roundKey, setRoundKey] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [focus, setFocus] = useState<string>();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const views = getFlowRoundViews(data?.flows, data?.rounds);
  const keys = [
    ...new Set(
      views.map((view) => (view.roundIndex == null ? 'pending' : String(view.roundIndex))),
    ),
  ];
  const activeKey = keys.includes(roundKey ?? '') ? roundKey! : keys[0];
  const candidates = views.filter(
    (view) => (view.roundIndex == null ? 'pending' : String(view.roundIndex)) === activeKey,
  );
  const referenced = new Set(
    candidates.flatMap((view) =>
      view.version.nodes.flatMap((node) => (node.subFlowId ? [node.subFlowId] : [])),
    ),
  );
  const roots = candidates.filter((view) => !referenced.has(view.version.flowId));
  const visibleViews = roots.length ? roots : candidates;
  const graph = buildFlowGraph(
    visibleViews,
    collapsed,
    selected,
    (id) => {
      setCollapsed((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    setFocus,
    focus,
  );
  if (!views.length) return <Empty description={t('flow.empty')} />;
  const edgeSelection = graph.transitions.get(selected ?? '');
  const checkSelection =
    graph.checks.get(selected ?? '') ??
    (edgeSelection
      ? [...graph.checks.values()].find(
          (item) =>
            item.view.id === edgeSelection.view.id &&
            item.node.id === edgeSelection.edge.targetNodeKey,
        )
      : undefined);
  const attempts = (checkSelection?.view.run?.attempts ?? []).filter(
    (a) =>
      a.nodeId === checkSelection?.node.id &&
      (!edgeSelection || a.incomingEdgeId === edgeSelection.edge.id),
  );
  const crumbs: { id: string; title: string }[] = [];
  for (let id = focus; id && graph.groups.has(id); id = graph.groups.get(id)?.parent)
    crumbs.unshift({ id, title: graph.groups.get(id)!.title });
  const graphEdges = graph.edges.map((edge) => ({
    ...edge,
    markerEnd: { type: MarkerType.Arrow, color: cssVar.colorTextQuaternary, width: 16, height: 16 },
    style: {
      stroke: edge.id === selected ? cssVar.colorPrimary : cssVar.colorTextQuaternary,
      strokeWidth: edge.id === selected ? 2 : 1.5,
    },
  }));
  const results = checkSelection ? (
    <FlowResults
      acceptanceId={acceptanceId!}
      attempts={attempts}
      edges={checkSelection.view.version.edges}
      key={`${checkSelection.view.id}:${selected}`}
      node={checkSelection.node}
      selectedEdge={edgeSelection?.edge}
      canReview={Boolean(
        data?.canReview &&
        checkSelection.view.roundIndex != null &&
        checkSelection.view.roundIndex ===
          Math.max(...(data?.rounds.map((r) => r.run.roundIndex ?? 0) ?? [0])),
      )}
      onClose={() => setSelected(undefined)}
      onSaved={mutate}
    />
  ) : null;
  const stage = (
    <Flexbox
      flex={fullscreen ? 1 : undefined}
      gap={16}
      {...stylex.props(fullscreen && styles.stage)}
    >
      <Flexbox
        horizontal
        align="center"
        gap={8}
        justify="space-between"
        wrap="wrap"
        {...sx([styles.toolbar], undefined, { maxWidth: contentMeasure })}
      >
        <Flexbox horizontal align="center" gap={4}>
          <Button size="small" type="text" onClick={() => setFocus(undefined)}>
            {t('flow.allGroups')}
          </Button>
          {crumbs.map((crumb) => (
            <Flexbox horizontal align="center" gap={4} key={crumb.id}>
              <Text type="secondary">/</Text>
              <Button size="small" type="text" onClick={() => setFocus(crumb.id)}>
                {crumb.title}
              </Button>
            </Flexbox>
          ))}
        </Flexbox>
        <Flexbox horizontal align="center" gap={8} wrap="wrap">
          <AcceptancePlanReview runId={candidates[0]?.run?.verifyRunId} />
          <Button
            size="small"
            type="text"
            onClick={() => setDisplay(showOutline ? 'graph' : 'outline')}
          >
            {t(showOutline ? 'flow.graphView' : 'flow.outlineView')}
          </Button>
          <Select
            size="small"
            style={{ width: 120, flexShrink: 0 }}
            value={activeKey}
            options={keys.map((key) => ({
              value: key,
              label:
                key === 'pending'
                  ? t('flow.pendingPlan')
                  : t('acceptance.round', { round: Number(key) }),
            }))}
            onChange={(value: string) => {
              setRoundKey(value);
              setFocus(undefined);
              setSelected(undefined);
            }}
          />
          <ActionIcon
            aria-label={t(fullscreen ? 'flow.exitFullscreen' : 'flow.fullscreen')}
            icon={fullscreen ? Minimize2 : Maximize2}
            ref={fullscreenButton}
            title={t(fullscreen ? 'flow.exitFullscreen' : 'flow.fullscreen')}
            onClick={() => setFullscreen((value) => !value)}
          />
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal flex={fullscreen ? 1 : undefined} {...stylex.props(styles.workspace)}>
        {showOutline ? (
          <Flexbox flex={1} {...sx([styles.outline], undefined, { maxWidth: contentMeasure })}>
            <FlowOutline edges={graphEdges} nodes={graph.nodes} onSelect={setSelected} />
          </Flexbox>
        ) : (
          <ReactFlowProvider key={activeKey}>
            <FlowCanvas
              edges={graphEdges}
              fullscreen={fullscreen}
              nodeTypes={nodeTypes}
              nodes={graph.nodes}
              viewKey={focus ?? activeKey}
              onSelect={setSelected}
            />
          </ReactFlowProvider>
        )}
        {!fullscreen && results && panelHost && createPortal(results, panelHost)}
      </Flexbox>
    </Flexbox>
  );
  if (!fullscreen) return stage;
  return createPortal(
    <Flexbox horizontal {...stylex.props(styles.fullscreen)}>
      {stage}
      {results && <Flexbox {...stylex.props(styles.details)}>{results}</Flexbox>}
    </Flexbox>,
    appElement ?? document.body,
  );
}
