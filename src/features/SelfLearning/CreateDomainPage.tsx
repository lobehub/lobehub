'use client';

import { ActionIcon, Block, Flexbox, Icon, Input, Text, TextArea } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createGlobalStyle, createStaticStyles, cssVar } from 'antd-style';
import {
  AnchorIcon,
  ArrowLeftIcon,
  LayersIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import urlJoin from 'url-join';

import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ExpertiseDomainDraft } from '@/services/expertise';
import { expertiseService } from '@/services/expertise';
import { useAgentStore } from '@/store/agent';

const GENERATION_ESTIMATE_SECONDS = 120;

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    display: flex;
  `,
  content: css`
    width: 100%;
    max-width: 960px;
    padding-block: 40px 96px;
  `,
  footer: css`
    position: sticky;
    z-index: 2;
    inset-block-end: 0;

    padding-block: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgLayout};
  `,
  head: css`
    padding-block-end: 24px;
  `,
  inputShell: css`
    position: relative;
    overflow: hidden;
    border-radius: 8px;
    background: ${cssVar.colorBgElevated};

    textarea {
      min-height: 320px !important;
      padding: 20px;
      border: none;

      font-size: 14px;

      background: transparent;
      box-shadow: none;
    }
  `,
  inputShellLoading: css`
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

interface StoredCreateDraft {
  adjustment?: string;
  brief: string;
  draft?: ExpertiseDomainDraft;
}

export const formatRemainingTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
};

const readStoredDraft = (storageKey: string): StoredCreateDraft => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { brief: '' };
    const parsed = JSON.parse(raw) as StoredCreateDraft;
    return typeof parsed.brief === 'string' ? parsed : { brief: '' };
  } catch {
    return { brief: '' };
  }
};

const DomainBorderFlowStyle = createGlobalStyle`
  @property --domain-border-angle {
    inherits: false;
    initial-value: 0deg;
    syntax: '<angle>';
  }
`;

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
  const agentId = useAgentStore((s) => s.activeAgentId);
  const storageKey = `self-learning:create:${agentId}`;
  const [stored] = useState(() => readStoredDraft(storageKey));
  const [adjustment, setAdjustment] = useState(stored.adjustment ?? '');
  const [brief, setBrief] = useState(stored.brief);
  const [step, setStep] = useState<'describe' | 'preparing' | 'review'>(
    stored.draft ? 'review' : 'describe',
  );
  const [draft, setDraft] = useState<ExpertiseDomainDraft | undefined>(stored.draft);
  const [creating, setCreating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(GENERATION_ESTIMATE_SECONDS);
  const meta = useAgentDisplayMeta(agentId ?? '');

  useEffect(() => {
    if (brief.trim() || draft || adjustment.trim())
      localStorage.setItem(
        storageKey,
        JSON.stringify({ adjustment, brief, draft } satisfies StoredCreateDraft),
      );
    else localStorage.removeItem(storageKey);
  }, [adjustment, brief, draft, storageKey]);

  useEffect(() => {
    if (step !== 'preparing' && !refining) return;
    setRemainingSeconds(GENERATION_ESTIMATE_SECONDS);
    const timer = window.setInterval(
      () => setRemainingSeconds((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [refining, step]);

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
  }, [agentId, brief, draft, t]);

  const refine = useCallback(async () => {
    if (!agentId || !brief.trim() || !draft || !adjustment.trim()) return;
    setRefining(true);
    try {
      setDraft(
        await expertiseService.draftDomain({
          adjustment: adjustment.trim(),
          agentId,
          brief: brief.trim(),
          currentDraft: draft,
        }),
      );
      setAdjustment('');
    } catch {
      toast.error(t('create.adjust.failed'));
    } finally {
      setRefining(false);
    }
  }, [adjustment, agentId, brief, draft, t]);

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
        title: draft.title.trim(),
      });
      localStorage.removeItem(storageKey);
      navigate(urlJoin('/agent', agentId, 'self-learning', id));
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
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Enter' || (!e.metaKey && !e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      void refine();
    },
    [refine],
  );

  const patch = (p: Partial<ExpertiseDomainDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const overviewPath = agentId ? urlJoin('/agent', agentId, 'self-learning') : '/';

  return (
    <Flexbox height={'100%'} width={'100%'}>
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
            <DomainBorderFlowStyle />
            <Flexbox horizontal className={styles.head}>
              <Flexbox flex={1} gap={6}>
                {step === 'review' && (
                  <Flexbox horizontal align={'center'} gap={8}>
                    <ActionIcon
                      icon={ArrowLeftIcon}
                      size={'small'}
                      title={t('create.back')}
                      onClick={() => setStep('describe')}
                    />
                    <Text fontSize={12} type={'secondary'}>
                      {t('create.reviewStep')}
                    </Text>
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
                    <div
                      className={`${styles.inputShell} ${step === 'preparing' ? styles.inputShellLoading : ''}`}
                    >
                      <TextArea
                        autoFocus
                        disabled={step === 'preparing'}
                        placeholder={t('create.briefPlaceholder')}
                        value={brief}
                        variant={'borderless'}
                        onChange={(e) => setBrief(e.target.value)}
                      />
                    </div>
                    <Text type={'secondary'}>
                      {step === 'preparing'
                        ? remainingSeconds > 0
                          ? t('create.generatingCountdown', {
                              time: formatRemainingTime(remainingSeconds),
                            })
                          : t('create.generatingAlmostDone')
                        : t('create.briefHelp')}
                    </Text>
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
                </Flexbox>
                <Flexbox className={styles.reviewSection} gap={6}>
                  <Text fontSize={12} type={'secondary'}>
                    {t('create.reviewHelp')}
                  </Text>
                  {draft.rationale && (
                    <Text fontSize={13} type={'secondary'}>
                      {draft.rationale}
                    </Text>
                  )}
                </Flexbox>

                <Block padding={12} variant={'outlined'} onKeyDown={onAdjustmentKeyDown}>
                  <Flexbox gap={10}>
                    <Flexbox gap={4}>
                      <Text fontSize={13} weight={600}>
                        {t('create.adjust.title')}
                      </Text>
                      <Text fontSize={12} type={'secondary'}>
                        {refining
                          ? remainingSeconds > 0
                            ? t('create.adjust.generatingCountdown', {
                                time: formatRemainingTime(remainingSeconds),
                              })
                            : t('create.generatingAlmostDone')
                          : t('create.adjust.help')}
                      </Text>
                    </Flexbox>
                    <Flexbox horizontal align={'end'} gap={8}>
                      <TextArea
                        autoSize={{ maxRows: 6, minRows: 2 }}
                        disabled={refining}
                        placeholder={t('create.adjust.placeholder')}
                        style={{ flex: 1 }}
                        value={adjustment}
                        variant={'filled'}
                        onChange={(e) => setAdjustment(e.target.value)}
                      />
                      <Button
                        disabled={!adjustment.trim() || refining}
                        icon={RefreshCwIcon}
                        loading={refining}
                        onClick={() => void refine()}
                      >
                        {refining ? t('create.adjust.adjusting') : t('create.adjust.action')}
                      </Button>
                    </Flexbox>
                  </Flexbox>
                </Block>

                <Flexbox className={styles.reviewSection} gap={10}>
                  <Text fontSize={13} weight={600}>
                    {t('create.field.domainFilter')}
                  </Text>
                  <TextArea
                    autoSize={{ maxRows: 6, minRows: 2 }}
                    value={draft.domainFilter}
                    variant={'filled'}
                    onChange={(e) => patch({ domainFilter: e.target.value })}
                  />
                  <Text fontSize={13} weight={600}>
                    {t('create.field.outOfScope')}
                  </Text>
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

            <Flexbox
              horizontal
              align={'center'}
              className={styles.footer}
              justify={'space-between'}
            >
              <Flexbox horizontal align={'center'} gap={6}>
                <AssigneeAvatar agentId={agentId ?? ''} size={18} />
                <Text fontSize={12}>{meta?.title}</Text>
              </Flexbox>
              <Flexbox horizontal align={'center'} gap={4}>
                {step === 'review' && (
                  <Button
                    disabled={refining}
                    icon={RefreshCwIcon}
                    size={'small'}
                    style={{ color: cssVar.colorTextTertiary }}
                    type={'text'}
                    onClick={() => void generate()}
                  >
                    {t('create.regenerate')}
                  </Button>
                )}
                <Button
                  loading={step === 'preparing' || creating || refining}
                  shape={'round'}
                  size={'small'}
                  type={'primary'}
                  disabled={
                    step === 'preparing' ||
                    refining ||
                    (step === 'describe' ? !brief.trim() : !canCreate)
                  }
                  onClick={() => void primaryRef.current?.()}
                >
                  {step === 'preparing'
                    ? t('create.generating')
                    : refining
                      ? t('create.adjust.adjusting')
                      : step === 'describe'
                        ? t('create.next')
                        : t('create.confirm')}
                </Button>
              </Flexbox>
            </Flexbox>
          </Flexbox>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

CreateDomainPage.displayName = 'CreateDomainPage';

export default CreateDomainPage;
