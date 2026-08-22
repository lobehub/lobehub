'use client';

import { ActionIcon, Flexbox, Icon, Input, Text, TextArea } from '@lobehub/ui';
import { Button, Popover, toast } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { createGlobalStyle, createStaticStyles, cssVar } from 'antd-style';
import {
  AnchorIcon,
  ArrowLeftIcon,
  LayersIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import urlJoin from 'url-join';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import { useResolvedAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ExpertiseDomainDraft } from '@/services/expertise';
import { expertiseService } from '@/services/expertise';
import { useAgentStore } from '@/store/agent';
import { shinyTextStyles } from '@/styles';

import { type AdjustmentTarget, mergeAdjustedBlock } from './createDomainAdjustment';
import { useCreateDomainDraft } from './useCreateDomainDraft';

const GENERATION_ESTIMATE_SECONDS = 90;

const emptyAdjustments: Record<AdjustmentTarget, string> = {
  canonEntries: '',
  domainFilter: '',
  layers: '',
  outOfScope: '',
  rationale: '',
};

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    display: flex;
  `,
  content: css`
    width: 100%;
    max-width: 960px;
    padding-block: 16px 96px;
  `,
  footer: css`
    position: sticky;
    z-index: 2;
    inset-block-end: 0;

    padding-block: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  head: css`
    padding-block-end: 24px;
  `,
  generatingStatus: css`
    min-height: 36px;
    padding-block: 6px;
    color: ${cssVar.colorTextSecondary};
  `,
  generatingTextItem: css`
    display: flex;
    align-items: center;

    height: 22px;

    font-size: 14px;
    font-weight: 500;
    line-height: 22px;
    white-space: nowrap;
  `,
  generatingTextTrack: css`
    animation: self-learning-generation-roll 16s cubic-bezier(0.4, 0, 0.2, 1) infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }

    @keyframes self-learning-generation-roll {
      0%,
      20% {
        transform: translateY(0);
      }

      25%,
      45% {
        transform: translateY(-22px);
      }

      50%,
      70% {
        transform: translateY(-44px);
      }

      75%,
      95% {
        transform: translateY(-66px);
      }

      100% {
        transform: translateY(-88px);
      }
    }
  `,
  generatingTextViewport: css`
    overflow: hidden;
    height: 22px;
  `,
  // Wraps the brief textarea so the loading state can draw the same flowing
  // border the goal creator uses — the shell owns the ring, not the input.
  inputShell: css`
    position: relative;
    border-radius: 8px;
  `,
  // Only while generating: a conic-gradient ring rotated by the animated
  // --domain-border-angle, masked to a 2px edge so the textarea reads as lit.
  // `overflow: hidden` lives here, not on the resting shell, so the outlined
  // textarea's focus glow isn't clipped when the user is typing.
  inputShellLoading: css`
    overflow: hidden;

    &::after {
      pointer-events: none;
      content: '';

      position: absolute;
      z-index: 1;
      inset: 0;

      padding: 2px;
      border-radius: inherit;

      background: conic-gradient(
        from var(--domain-border-angle),
        ${cssVar.colorBorderSecondary} 0deg 210deg,
        #ff3d8d 238deg,
        #8b5cf6 258deg,
        #00c8ff 278deg,
        #22e6a8 298deg,
        #ffd43b 318deg,
        #ff6b35 338deg,
        ${cssVar.colorBorderSecondary} 360deg
      );

      mask:
        linear-gradient(#fff 0 0) content-box,
        linear-gradient(#fff 0 0);

      animation: domain-input-flow 1.8s linear infinite;

      mask-composite: exclude;
    }

    @keyframes domain-input-flow {
      from {
        --domain-border-angle: 0deg;
      }

      to {
        --domain-border-angle: 360deg;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      &::after {
        animation: none;
      }
    }
  `,
  itemRow: css`
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) 28px;
    gap: 8px;
    align-items: start;

    padding-block: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  reviewSection: css`
    padding-block: 20px;

    &:first-child {
      padding-block: 0 4px;
    }
  `,
  rationale: css`
    margin: 0;
    padding-inline: 0;

    font-size: 16px;
    line-height: 1.75;
    color: ${cssVar.colorText};
  `,
  seq: css`
    padding-block-start: 8px;
    font-size: 14px;
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    box-sizing: border-box;
    width: 100%;
    padding-block: 4px 8px;
    padding-inline-end: 0;
    border: none;

    font-family: inherit;
    font-size: 28px;
    font-weight: 600;
    line-height: 1.4;
    color: inherit;

    background: transparent;
    outline: none;
  `,
  titleStatic: css`
    padding-block: 4px 8px;

    font-size: 28px;
    font-weight: 600;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

// A registered custom property is what lets the conic gradient's angle animate
// at all — a plain `--domain-border-angle` is an un-typed string CSS can't tween.
const DomainBorderFlowStyle = createGlobalStyle`
  @property --domain-border-angle {
    inherits: false;
    initial-value: 0deg;
    syntax: '<angle>';
  }
`;

export const formatRemainingTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
};

const slugify = (s: string, fallback: string) =>
  s
    .trim()
    .toLowerCase()
    .replaceAll(/[^\da-z]+/g, '-')
    .replaceAll(/^-|-$/g, '') || fallback;

/**
 * 两步建域，交互对齐 createGoal：① 一段话说清方向 → ② 检查它读出来的锚。
 *
 * 锚不只是名字和过滤器：分层决定经验挂在哪一层、经典依据决定「覆盖」意味着什么。
 * 这两样在落库前必须让人看见并能改 —— 所以 step 2 把整个锚候选摊开。
 */
const CreateDomainPage = memo(() => {
  const { t } = useTranslation('selfLearning');
  const navigate = useWorkspaceAwareNavigate();
  const { aid } = useParams<{ aid?: string }>();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const { agentId: routeAgentId } = useResolvedAgentRouteId(aid);
  const agentId = routeAgentId || activeAgentId;
  const { brief, clearDraft, draft, setBrief, setDraft, setStep, step, storageKey } =
    useCreateDomainDraft(agentId);
  const [creating, setCreating] = useState(false);
  const [adjustments, setAdjustments] = useState(emptyAdjustments);
  const [openAdjustment, setOpenAdjustment] = useState<AdjustmentTarget>();
  const [refiningTarget, setRefiningTarget] = useState<AdjustmentTarget>();
  const [remainingSeconds, setRemainingSeconds] = useState(GENERATION_ESTIMATE_SECONDS);

  useEffect(() => {
    if (step !== 'preparing' && !refiningTarget) return;
    setRemainingSeconds(GENERATION_ESTIMATE_SECONDS);
    const timer = window.setInterval(
      () => setRemainingSeconds((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [refiningTarget, step]);

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (!brief.trim()) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [brief]);

  const generate = useCallback(async () => {
    if (!agentId || !brief.trim()) return;
    setStep('preparing');
    try {
      setDraft(await expertiseService.draftDomain({ agentId, brief: brief.trim() }));
      setStep('review');
    } catch {
      toast.error(t('create.failed'));
      setStep(draft ? 'review' : 'describe');
    }
  }, [agentId, brief, draft, setDraft, setStep, t]);

  const refine = useCallback(
    async (target: AdjustmentTarget) => {
      const adjustment = adjustments[target].trim();
      if (!agentId || !brief.trim() || !draft || !adjustment) return;
      setRefiningTarget(target);
      try {
        const adjusted = await expertiseService.draftDomain({
          adjustment,
          agentId,
          brief: brief.trim(),
          currentDraft: draft,
        });
        setDraft((current) => (current ? mergeAdjustedBlock(current, adjusted, target) : current));
        setAdjustments((current) => ({ ...current, [target]: '' }));
        setOpenAdjustment(undefined);
      } catch {
        toast.error(t('create.adjust.failed'));
      } finally {
        setRefiningTarget(undefined);
      }
    },
    [adjustments, agentId, brief, draft, setDraft, t],
  );

  const canCreate = !!draft && !!draft.title.trim() && !!draft.domainFilter.trim() && !creating;

  const create = useCallback(async () => {
    if (!agentId || !draft || !canCreate) return;
    setCreating(true);
    try {
      const id = await expertiseService.createDomain({
        ...draft,
        agentId,
        brief: brief.trim(),
        canonEntries: draft.canonEntries.filter((c) => c.title.trim()),
        domainFilter: draft.domainFilter.trim(),
        layers: draft.layers.filter((l) => l.title.trim()),
        outOfScope: draft.outOfScope?.trim() || null,
        rationale: draft.rationale?.trim() || null,
        title: draft.title.trim(),
      });
      if (storageKey) localStorage.removeItem(storageKey);
      navigate(urlJoin('/agent', agentId, 'self-evolving', id));
    } catch {
      toast.error(t('create.failed'));
    } finally {
      setCreating(false);
    }
  }, [agentId, brief, canCreate, draft, navigate, storageKey, t]);

  const primaryRef = useRef<() => void>(undefined);
  primaryRef.current = step === 'describe' ? generate : step === 'review' ? create : undefined;
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      void primaryRef.current?.();
    }
  }, []);
  const onAdjustmentKeyDown = useCallback(
    (target: AdjustmentTarget, e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Enter' || (!e.metaKey && !e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      void refine(target);
    },
    [refine],
  );

  const renderAdjustmentContent = (target: AdjustmentTarget) => {
    const isRefining = refiningTarget === target;

    return (
      <Flexbox gap={8} onKeyDown={(e) => onAdjustmentKeyDown(target, e)}>
        <TextArea
          autoFocus
          autoSize={{ maxRows: 5, minRows: 2 }}
          disabled={isRefining}
          placeholder={t(`create.adjust.placeholder.${target}`)}
          value={adjustments[target]}
          variant={'filled'}
          onChange={(e) => setAdjustments((current) => ({ ...current, [target]: e.target.value }))}
        />
        <Flexbox horizontal justify={'end'}>
          <Button
            disabled={!adjustments[target].trim() || isRefining}
            icon={RefreshCwIcon}
            loading={isRefining}
            onClick={() => void refine(target)}
          >
            {isRefining ? t('create.adjust.adjusting') : t('create.adjust.action')}
          </Button>
        </Flexbox>
        {isRefining && (
          <Text fontSize={12} type={'secondary'}>
            {remainingSeconds > 0
              ? t('create.adjust.generatingCountdown', {
                  time: formatRemainingTime(remainingSeconds),
                })
              : t('create.generatingAlmostDone')}
          </Text>
        )}
      </Flexbox>
    );
  };

  const renderAdjustmentButton = (target: AdjustmentTarget) => {
    const isOpen = openAdjustment === target;
    const isRefining = refiningTarget === target;

    return (
      <Popover
        content={renderAdjustmentContent(target)}
        open={isOpen}
        placement={'bottomRight'}
        styles={{ content: { padding: 12, width: 'min(520px, calc(100vw - 32px))' } }}
        trigger={'click'}
        onOpenChange={(open) => setOpenAdjustment(open ? target : undefined)}
      >
        <Button
          aria-expanded={isOpen}
          aria-haspopup={'dialog'}
          disabled={!!refiningTarget && !isRefining}
          icon={SparklesIcon}
          size={'small'}
          type={'text'}
        >
          {t('create.adjust.blockAction')}
        </Button>
      </Popover>
    );
  };

  const patch = (p: Partial<ExpertiseDomainDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const overviewPath = agentId ? urlJoin('/agent', agentId, 'self-evolving') : '/';
  const returnToOverview = () => {
    clearDraft();
    setAdjustments(emptyAdjustments);
    setOpenAdjustment(undefined);
    setRefiningTarget(undefined);
    navigate(overviewPath);
  };
  const generatingMessages = [
    t('create.generating'),
    t('create.generatingScope'),
    t('create.generatingCanon'),
    t('create.generatingLayers'),
    t('create.generating'),
  ];

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <DomainBorderFlowStyle />
      <NavHeader
        styles={{ left: { paddingInlineStart: 24 } }}
        left={
          agentId ? (
            <AgentBreadcrumb
              agentId={agentId}
              extraItems={[t('create.modalTitle')]}
              title={<Link to={overviewPath}>{t('title')}</Link>}
            />
          ) : null
        }
      />
      <Flexbox className={styles.body} flex={1} width={'100%'}>
        <WideScreenContainer minWidth={960}>
          <Flexbox className={styles.content} onKeyDown={onKeyDown}>
            <Flexbox horizontal className={styles.head}>
              <Flexbox flex={1} gap={6}>
                {step === 'review' && (
                  <Flexbox horizontal>
                    <Button
                      icon={ArrowLeftIcon}
                      size={'small'}
                      type={'text'}
                      onClick={returnToOverview}
                    >
                      {t('create.back')}
                    </Button>
                  </Flexbox>
                )}
                {step === 'review' && draft ? (
                  <input
                    className={styles.title}
                    maxLength={80}
                    placeholder={t('create.field.title')}
                    value={draft.title}
                    onChange={(e) => patch({ title: e.target.value })}
                  />
                ) : (
                  <div className={styles.titleStatic}>{t('create.modalTitle')}</div>
                )}
                {step !== 'review' && (
                  <>
                    <Text fontSize={12} type={'secondary'}>
                      {t('create.briefHelp')}
                    </Text>
                    <div
                      className={`${styles.inputShell} ${step === 'preparing' ? styles.inputShellLoading : ''}`}
                    >
                      <TextArea
                        autoFocus
                        autoSize={{ maxRows: 10, minRows: 5 }}
                        disabled={step === 'preparing'}
                        placeholder={t('create.briefPlaceholder')}
                        value={brief}
                        variant={step === 'preparing' ? 'borderless' : 'outlined'}
                        onChange={(e) => setBrief(e.target.value)}
                      />
                    </div>
                    {step === 'preparing' ? (
                      <Flexbox
                        horizontal
                        align={'center'}
                        className={styles.generatingStatus}
                        gap={10}
                        justify={'space-between'}
                      >
                        <Flexbox horizontal align={'center'} gap={8}>
                          <NeuralNetworkLoading size={18} />
                          <div
                            aria-label={t('create.generating')}
                            className={styles.generatingTextViewport}
                            role={'status'}
                          >
                            <div aria-hidden className={styles.generatingTextTrack}>
                              {generatingMessages.map((message, index) => (
                                <div
                                  className={`${styles.generatingTextItem} ${shinyTextStyles.shinyText}`}
                                  key={index}
                                >
                                  {message}
                                </div>
                              ))}
                            </div>
                          </div>
                        </Flexbox>
                        <Text fontSize={12} type={'secondary'}>
                          {remainingSeconds > 0
                            ? t('create.generatingCountdown', {
                                time: formatRemainingTime(remainingSeconds),
                              })
                            : t('create.generatingAlmostDone')}
                        </Text>
                      </Flexbox>
                    ) : (
                      <Flexbox horizontal align={'center'} justify={'end'}>
                        <Button
                          disabled={!brief.trim()}
                          icon={SparklesIcon}
                          type={'primary'}
                          onClick={() => void generate()}
                        >
                          {t('create.generate')}
                        </Button>
                      </Flexbox>
                    )}
                  </>
                )}
              </Flexbox>
            </Flexbox>

            {step === 'review' && draft && (
              <Flexbox className={styles.body}>
                <Flexbox className={styles.reviewSection} gap={10}>
                  <Text fontSize={13} weight={600}>
                    {t('create.field.brief')}
                  </Text>
                  <TextArea
                    autoSize={{ maxRows: 8, minRows: 3 }}
                    value={brief}
                    variant={'filled'}
                    onChange={(e) => setBrief(e.target.value)}
                  />
                  <Flexbox horizontal justify={'end'} style={{ paddingBlockEnd: 8 }}>
                    <Button
                      disabled={!brief.trim() || !!refiningTarget}
                      icon={RefreshCwIcon}
                      size={'small'}
                      onClick={() => void generate()}
                    >
                      {t('create.regenerate')}
                    </Button>
                  </Flexbox>
                </Flexbox>
                <Divider style={{ margin: 0 }} />
                <Flexbox className={styles.reviewSection} gap={12}>
                  <Flexbox horizontal align={'flex-start'} gap={8} justify={'space-between'}>
                    <Text fontSize={14} type={'secondary'}>
                      {t('create.reviewHelp')}
                    </Text>
                    <Flexbox flex={'none'}>{renderAdjustmentButton('rationale')}</Flexbox>
                  </Flexbox>
                  <TextArea
                    autoSize={{ maxRows: 8, minRows: 2 }}
                    className={styles.rationale}
                    // An in-flight adjustment answers from the draft as it was when the
                    // request left, so edits made meanwhile would be silently overwritten
                    // when the response merges back.
                    disabled={refiningTarget === 'rationale'}
                    placeholder={t('create.field.rationalePlaceholder')}
                    value={draft.rationale ?? ''}
                    variant={'borderless'}
                    onChange={(e) => patch({ rationale: e.target.value })}
                  />
                </Flexbox>

                <Flexbox className={styles.reviewSection} gap={10}>
                  <Flexbox horizontal align={'center'} justify={'space-between'}>
                    <Text fontSize={13} weight={600}>
                      {t('create.field.domainFilter')}
                    </Text>
                    {renderAdjustmentButton('domainFilter')}
                  </Flexbox>
                  <TextArea
                    autoSize={{ maxRows: 6, minRows: 2 }}
                    value={draft.domainFilter}
                    variant={'filled'}
                    onChange={(e) => patch({ domainFilter: e.target.value })}
                  />
                </Flexbox>
                <Flexbox className={styles.reviewSection} gap={10}>
                  <Flexbox horizontal align={'center'} justify={'space-between'}>
                    <Text fontSize={13} weight={600}>
                      {t('create.field.outOfScope')}
                    </Text>
                    {renderAdjustmentButton('outOfScope')}
                  </Flexbox>
                  <TextArea
                    autoSize={{ maxRows: 5, minRows: 2 }}
                    placeholder={t('create.field.outOfScopePlaceholder')}
                    value={draft.outOfScope ?? ''}
                    variant={'filled'}
                    onChange={(e) => patch({ outOfScope: e.target.value })}
                  />
                </Flexbox>

                <Flexbox className={styles.reviewSection} gap={10}>
                  <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                    <Flexbox horizontal align={'center'} gap={8}>
                      <Icon color={cssVar.colorTextTertiary} icon={AnchorIcon} size={16} />
                      <Text fontSize={13} weight={600}>
                        {t('create.anchor.canon')}
                      </Text>
                      <Text fontSize={12} type={'secondary'}>
                        {t('create.anchor.canonHint')}
                      </Text>
                    </Flexbox>
                    <Flexbox horizontal align={'center'} gap={4}>
                      {renderAdjustmentButton('canonEntries')}
                      <Button
                        icon={PlusIcon}
                        size={'small'}
                        type={'text'}
                        onClick={() =>
                          patch({
                            canonEntries: [
                              ...draft.canonEntries,
                              {
                                key: `canon-${draft.canonEntries.length + 1}`,
                                source: '',
                                statement: '',
                                title: '',
                              },
                            ],
                          })
                        }
                      >
                        {t('create.anchor.addCanon')}
                      </Button>
                    </Flexbox>
                  </Flexbox>
                  {draft.canonEntries.length === 0 && (
                    <Text fontSize={12} type={'secondary'}>
                      {t('create.anchor.noCanon')}
                    </Text>
                  )}
                  {draft.canonEntries.map((entry, i) => (
                    <div className={styles.itemRow} key={i}>
                      <span className={styles.seq}>E{i + 1}</span>
                      <Flexbox gap={4}>
                        <Flexbox horizontal gap={8}>
                          <Input
                            placeholder={t('create.anchor.canonTitle')}
                            style={{ flex: 1 }}
                            value={entry.title}
                            variant={'filled'}
                            onChange={(e) =>
                              patch({
                                canonEntries: draft.canonEntries.map((c, j) =>
                                  j === i
                                    ? {
                                        ...c,
                                        key: slugify(e.target.value, c.key),
                                        title: e.target.value,
                                      }
                                    : c,
                                ),
                              })
                            }
                          />
                          <Input
                            placeholder={t('create.anchor.canonSource')}
                            style={{ flex: 1 }}
                            value={entry.source}
                            variant={'filled'}
                            onChange={(e) =>
                              patch({
                                canonEntries: draft.canonEntries.map((c, j) =>
                                  j === i ? { ...c, source: e.target.value } : c,
                                ),
                              })
                            }
                          />
                        </Flexbox>
                        <TextArea
                          autoSize={{ maxRows: 4, minRows: 1 }}
                          placeholder={t('create.anchor.canonStatement')}
                          value={entry.statement}
                          variant={'borderless'}
                          onChange={(e) =>
                            patch({
                              canonEntries: draft.canonEntries.map((c, j) =>
                                j === i ? { ...c, statement: e.target.value } : c,
                              ),
                            })
                          }
                        />
                      </Flexbox>
                      <ActionIcon
                        icon={Trash2Icon}
                        size={'small'}
                        onClick={() =>
                          patch({ canonEntries: draft.canonEntries.filter((_, j) => j !== i) })
                        }
                      />
                    </div>
                  ))}
                </Flexbox>
                <Flexbox className={styles.reviewSection} gap={10}>
                  <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                    <Flexbox horizontal align={'center'} gap={8}>
                      <Icon color={cssVar.colorTextTertiary} icon={LayersIcon} size={16} />
                      <Text fontSize={13} weight={600}>
                        {t('create.anchor.layers')}
                      </Text>
                      <Text fontSize={12} type={'secondary'}>
                        {draft.layerSource === 'canonical' && draft.layerCanonRef
                          ? t('create.anchor.layersFrom', { ref: draft.layerCanonRef })
                          : t('create.anchor.layersInvented')}
                      </Text>
                    </Flexbox>
                    <Flexbox horizontal align={'center'} gap={4}>
                      {renderAdjustmentButton('layers')}
                      <Button
                        icon={PlusIcon}
                        size={'small'}
                        type={'text'}
                        onClick={() =>
                          patch({
                            layers: [
                              ...draft.layers,
                              {
                                description: null,
                                key: `layer-${draft.layers.length + 1}`,
                                title: '',
                              },
                            ],
                          })
                        }
                      >
                        {t('create.anchor.addLayer')}
                      </Button>
                    </Flexbox>
                  </Flexbox>
                  {draft.layers.length === 0 && (
                    <Text fontSize={12} type={'secondary'}>
                      {t('create.anchor.noLayers')}
                    </Text>
                  )}
                  {draft.layers.map((layer, i) => (
                    <div className={styles.itemRow} key={i}>
                      <span className={styles.seq}>L{i + 1}</span>
                      <Flexbox gap={4}>
                        <Input
                          placeholder={t('create.anchor.layerTitle')}
                          value={layer.title}
                          variant={'filled'}
                          onChange={(e) =>
                            patch({
                              layers: draft.layers.map((l, j) =>
                                j === i
                                  ? {
                                      ...l,
                                      key: slugify(e.target.value, l.key),
                                      title: e.target.value,
                                    }
                                  : l,
                              ),
                            })
                          }
                        />
                        <Input
                          placeholder={t('create.anchor.layerDesc')}
                          value={layer.description ?? ''}
                          variant={'borderless'}
                          onChange={(e) =>
                            patch({
                              layers: draft.layers.map((l, j) =>
                                j === i ? { ...l, description: e.target.value } : l,
                              ),
                            })
                          }
                        />
                      </Flexbox>
                      <ActionIcon
                        icon={Trash2Icon}
                        size={'small'}
                        onClick={() => patch({ layers: draft.layers.filter((_, j) => j !== i) })}
                      />
                    </div>
                  ))}
                </Flexbox>
              </Flexbox>
            )}

            {step === 'review' && (
              <Flexbox horizontal align={'center'} className={styles.footer} justify={'end'}>
                <Flexbox horizontal align={'center'} gap={4}>
                  <Button
                    disabled={!!refiningTarget || !canCreate}
                    loading={creating}
                    type={'primary'}
                    onClick={() => void primaryRef.current?.()}
                  >
                    {t('create.confirm')}
                  </Button>
                </Flexbox>
              </Flexbox>
            )}
          </Flexbox>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

CreateDomainPage.displayName = 'CreateDomainPage';

export default CreateDomainPage;
