'use client';

import { ActionIcon, Flexbox, Icon, Input, Text, TextArea } from '@lobehub/ui';
import { Button, createModal, toast, useModalContext } from '@lobehub/ui/base-ui';
import { createGlobalStyle, createStaticStyles, cssVar } from 'antd-style';
import {
  AnchorIcon,
  ArrowLeftIcon,
  LayersIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import type { ExpertiseDomainDraft } from '@/services/expertise';
import { expertiseService } from '@/services/expertise';

interface CreateDomainContentProps {
  agentId: string;
  onCreated: (domainId: string) => void;
}

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;

    min-height: 0;
    max-height: min(70vh, 680px);
    padding-block: 8px 24px;
    padding-inline: 16px;
  `,
  close: css`
    position: absolute;
    inset-block-start: 14px;
    inset-inline-end: 14px;
  `,
  footer: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  head: css`
    position: relative;
    padding-block: 16px 8px;
    padding-inline: 16px;
  `,
  inputShell: css`
    position: relative;
    overflow: hidden;
    border-radius: 8px;
    background: ${cssVar.colorBgElevated};

    textarea {
      min-height: 206px !important;
      padding: 16px;
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
    padding-block: 14px;

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
    padding-inline-end: 40px;
    border: none;

    font-family: inherit;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.4;
    color: inherit;

    background: transparent;
    outline: none;
  `,
  titleStatic: css`
    padding-block: 4px 8px;
    padding-inline-end: 40px;

    font-size: 20px;
    font-weight: 600;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

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
const CreateDomainContent = memo<CreateDomainContentProps>(({ agentId, onCreated }) => {
  const { t } = useTranslation('selfLearning');
  const { close } = useModalContext();
  const storageKey = `self-learning:create:${agentId}`;
  const [brief, setBrief] = useState(() => localStorage.getItem(storageKey) ?? '');
  const [step, setStep] = useState<'describe' | 'preparing' | 'review'>('describe');
  const [draft, setDraft] = useState<ExpertiseDomainDraft>();
  const [creating, setCreating] = useState(false);
  const meta = useAgentDisplayMeta(agentId);

  useEffect(() => {
    if (brief.trim()) localStorage.setItem(storageKey, brief);
    else localStorage.removeItem(storageKey);
  }, [brief, storageKey]);

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (!brief.trim()) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [brief]);

  const generate = useCallback(async () => {
    if (!brief.trim()) return;
    setStep('preparing');
    try {
      setDraft(await expertiseService.draftDomain({ agentId, brief: brief.trim() }));
      setStep('review');
    } catch {
      toast.error(t('create.failed'));
      setStep(draft ? 'review' : 'describe');
    }
  }, [agentId, brief, draft, t]);

  const canCreate = !!draft && !!draft.title.trim() && !!draft.domainFilter.trim() && !creating;

  const create = useCallback(async () => {
    if (!draft || !canCreate) return;
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
      onCreated(id);
      close();
    } catch {
      toast.error(t('create.failed'));
    } finally {
      setCreating(false);
    }
  }, [agentId, brief, canCreate, close, draft, onCreated, storageKey, t]);

  const primaryRef = useRef<() => void>(undefined);
  primaryRef.current = step === 'describe' ? generate : step === 'review' ? create : undefined;
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      void primaryRef.current?.();
    }
  }, []);

  const patch = (p: Partial<ExpertiseDomainDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  return (
    <Flexbox onKeyDown={onKeyDown}>
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
                {step === 'preparing' ? t('create.generating') : t('create.briefHelp')}
              </Text>
            </>
          )}
        </Flexbox>
        <ActionIcon className={styles.close} icon={XIcon} onClick={close} />
      </Flexbox>

      {step === 'review' && draft && (
        <Flexbox className={styles.body}>
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
                <span className={styles.seq}>C{i + 1}</span>
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
                              ? { ...c, key: slugify(e.target.value, c.key), title: e.target.value }
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
                      { description: null, key: `layer-${draft.layers.length + 1}`, title: '' },
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
                            ? { ...l, key: slugify(e.target.value, l.key), title: e.target.value }
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

      <Flexbox horizontal align={'center'} className={styles.footer} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={6}>
          <AssigneeAvatar agentId={agentId} size={18} />
          <Text fontSize={12}>{meta?.title}</Text>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={4}>
          {step === 'review' && (
            <Button
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
            disabled={step === 'preparing' || (step === 'describe' ? !brief.trim() : !canCreate)}
            loading={step === 'preparing' || creating}
            shape={'round'}
            size={'small'}
            type={'primary'}
            onClick={() => void primaryRef.current?.()}
          >
            {step === 'preparing'
              ? t('create.generating')
              : step === 'describe'
                ? t('create.next')
                : t('create.confirm')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

CreateDomainContent.displayName = 'CreateDomainContent';

export const openCreateDomainModal = (props: CreateDomainContentProps) =>
  createModal({
    content: <CreateDomainContent {...props} />,
    footer: null,
    maskClosable: false,
    styles: { content: { overflow: 'hidden', padding: 0 } },
    title: null,
    width: 'min(88vw, 720px)',
  });
