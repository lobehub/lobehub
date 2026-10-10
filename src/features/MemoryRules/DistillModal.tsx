'use client';

import type { ExpertiseEnforcement } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  Checkbox,
  createModal,
  DropdownMenu,
  Input,
  Segmented,
  Spin,
  Text,
  TextArea,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from '@lobehub/ui';
import dayjs from 'dayjs';
import {
  ArrowLeftIcon,
  BellIcon,
  ChevronDownIcon,
  FileTextIcon,
  FolderIcon,
  FolderPlusIcon,
  LibraryIcon,
  MessageSquareTextIcon,
  ShieldCheckIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import GeneratingBorder from '@/components/GeneratingBorder';
import { openLibraryFilePicker } from '@/features/LibraryModal/FilePicker';
import {
  type DistillCandidate,
  type DistillInput,
  type DistillResult,
  expertiseService,
  type RuleGroup,
} from '@/services/expertise';
import { useFileStore } from '@/store/file';
import { shinyTextStyles } from '@/styles';

import { composeStyles } from './GroupModal';
import { useRecentPages, useTopics } from './useDistillSources';

const styles = createStaticStyles(({ css }) => ({
  candidate: css`
    display: flex;
    gap: 10px;
    align-items: flex-start;

    padding-block: 12px;
    padding-inline: 4px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  candidateOff: css`
    opacity: 0.55;
  `,
  chip: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 6px;
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  duplicate: css`
    font-size: 12px;
    color: ${cssVar.colorWarningText};
  `,
  option: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  optionActive: css`
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  optionMeta: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  optionTitle: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  options: css`
    overflow-y: auto;
    max-height: 280px;
  `,
  quote: css`
    margin-block: 4px 0;
    padding-inline-start: 10px;
    border-inline-start: 2px solid ${cssVar.colorBorder};

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  titleInput: css`
    padding-inline: 0;
    font-weight: 500;
  `,
}));

type SourceTab = 'document' | 'file' | 'text' | 'topic';

/** What the reviewer picked, with a name to show while it is being read. */
interface PickedSource {
  name: string;
  source: DistillInput['source'];
}

/** One candidate as the reviewer is shaping it before it is filed. */
interface Draft {
  candidate: DistillCandidate;
  enforcement: ExpertiseEnforcement;
  /** An existing group, or `new` for the model's proposed group. */
  groupId: string | 'new';
  keep: boolean;
  title: string;
}

interface DistillContentProps {
  /** Whether a proposed new group may be opened; a new group always mounts on the reviewer. */
  canOpenGroup: boolean;
  /** The groups of the part on screen; candidates are filed into these. */
  groups: RuleGroup[];
  onDone: (ids: string[]) => void;
}

/**
 * Distilling rules from a material the reviewer already has: pick it (paste or upload, a
 * document, a library file, or a conversation), let the model read it, then tick the candidates
 * worth keeping. A candidate that restates an existing rule starts unticked; ticking it records
 * the passage on that rule instead of filing a second copy.
 */
const DistillContent = ({ canOpenGroup, groups, onDone }: DistillContentProps) => {
  const { t } = useTranslation('memory');
  const { close } = useModalContext();
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'pick' | 'reading' | 'review'>('pick');
  const [tab, setTab] = useState<SourceTab>('text');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<PickedSource>();
  const [uploading, setUploading] = useState(false);
  const [keywords, setKeywords] = useState('');
  const [result, setResult] = useState<DistillResult>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);

  const recentPages = useRecentPages(tab === 'document');
  const pages = recentPages.items;
  const topicList = useTopics(tab === 'topic', keywords);
  const topics = topicList.items;
  const rules = useMemo(
    () =>
      groups.flatMap((group) =>
        group.rules
          .filter((rule) => rule.status === 'active')
          .map(({ id, title }) => ({ id, title })),
      ),
    [groups],
  );
  const titleOf = (id: string | null) => rules.find((rule) => rule.id === id)?.title;
  const groupTitle = (id: string, candidate: DistillCandidate) =>
    id === 'new'
      ? t('rules.distill.newGroup', { title: candidate.newGroup?.title ?? '' })
      : (groups.find((group) => group.domain.id === id)?.domain.title ?? '');

  // Pasted text stands on its own; anything else needs a pick in its own tab.
  const source: PickedSource | undefined =
    tab === 'text' && !picked && text.trim()
      ? {
          name: text
            .trim()
            .split('\n')[0]
            .replace(/^#+\s*/, '')
            .slice(0, 40),
          source: { text: text.trim(), type: 'text' },
        }
      : picked;

  const switchTab = (next: SourceTab) => {
    setTab(next);
    setPicked(undefined);
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const uploaded = await uploadWithProgress({ file });
      if (uploaded) setPicked({ name: file.name, source: { id: uploaded.id, type: 'file' } });
    } catch (error) {
      console.error('[MemoryRules] material upload failed:', error);
      toast.error(t('rules.distill.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const read = async () => {
    if (!source) return;
    setStep('reading');
    try {
      const next = await expertiseService.distillRules({
        groups: groups.map(({ domain }) => ({
          gate: domain.domainFilter,
          id: domain.id,
          title: domain.title,
        })),
        rules,
        source: source.source,
      });
      const fallback = groups[0]?.domain.id;
      setResult(next);
      setDrafts(
        next.candidates.map((candidate) => ({
          candidate,
          enforcement: candidate.enforcement,
          groupId:
            candidate.groupId ?? (canOpenGroup && candidate.newGroup ? 'new' : (fallback ?? 'new')),
          keep: !candidate.duplicateOf,
          title: candidate.title,
        })),
      );
      setStep('review');
    } catch (error) {
      console.error('[MemoryRules] distill failed:', error);
      toast.error(t('rules.distill.readFailed'));
      setStep('pick');
    }
  };

  const patch = (index: number, value: Partial<Draft>) =>
    setDrafts((current) => current.map((d, i) => (i === index ? { ...d, ...value } : d)));

  const kept = drafts.filter((draft) => draft.keep && draft.title.trim());

  const save = async () => {
    if (!result || kept.length === 0 || saving) return;
    setSaving(true);
    try {
      const saved = await expertiseService.commitDistilledRules({
        items: kept.map(({ candidate, enforcement, groupId, title }) =>
          candidate.duplicateOf
            ? { intoId: candidate.duplicateOf, kind: 'merge' as const, quote: candidate.quote }
            : {
                domainId: groupId === 'new' ? undefined : groupId,
                kind: 'create' as const,
                newGroup: groupId === 'new' ? (candidate.newGroup ?? undefined) : undefined,
                quote: candidate.quote,
                rule: {
                  compilability: candidate.compilability,
                  enforcement,
                  how: candidate.how ?? undefined,
                  limits: candidate.limits ?? undefined,
                  title: title.trim(),
                  why: candidate.why ?? undefined,
                },
              },
        ),
        material: result.material,
      });
      toast.success(t('rules.distill.saved', { count: saved.length }));
      onDone(saved.filter((item) => item.kind === 'create').map((item) => item.id));
      close();
    } catch (error) {
      console.error('[MemoryRules] distill save failed:', error);
      toast.error(t('rules.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const loadFailed = (retry: () => void) => (
    <Flexbox horizontal align={'center'} gap={8}>
      <Text type={'secondary'}>{t('rules.distill.loadFailed')}</Text>
      <Button onClick={retry}>{t('retry', { ns: 'common' })}</Button>
    </Flexbox>
  );

  const optionRow = (key: string, title: string, meta: string | undefined, onPick: () => void) => (
    <div
      key={key}
      className={cx(
        styles.option,
        picked?.source && 'id' in picked.source && picked.source.id === key && styles.optionActive,
      )}
      onClick={onPick}
    >
      <span className={styles.optionTitle}>{title || t('rules.distill.untitled')}</span>
      {meta && <span className={styles.optionMeta}>{meta}</span>}
    </div>
  );

  return (
    <Flexbox>
      <Flexbox className={composeStyles.head} gap={10}>
        {step === 'review' && (
          <Flexbox horizontal align={'center'} gap={8}>
            <ActionIcon
              icon={ArrowLeftIcon}
              size={'small'}
              title={t('rules.compose.back')}
              onClick={() => setStep('pick')}
            />
            <Text fontSize={12} type={'secondary'}>
              {t('rules.distill.reviewStep')}
            </Text>
          </Flexbox>
        )}
        <div className={composeStyles.titleStatic}>
          {step === 'review' && result
            ? t('rules.distill.reviewTitle', {
                count: result.candidates.length,
                title: result.material.title,
              })
            : t('rules.distill.title')}
        </div>
        {step === 'pick' && (
          <>
            <Text type={'secondary'}>{t('rules.distill.description')}</Text>
            <Segmented
              value={tab}
              options={[
                { label: t('rules.distill.tab.text'), value: 'text' },
                { label: t('rules.distill.tab.document'), value: 'document' },
                { label: t('rules.distill.tab.file'), value: 'file' },
                { label: t('rules.distill.tab.topic'), value: 'topic' },
              ]}
              onChange={(value) => switchTab(value as SourceTab)}
            />
          </>
        )}
        <ActionIcon className={composeStyles.close} icon={XIcon} onClick={() => close()} />
      </Flexbox>

      {step === 'pick' && (
        <Flexbox className={composeStyles.body} gap={10}>
          {tab === 'text' &&
            (picked ? (
              <Flexbox horizontal align={'center'} gap={8}>
                <Icon icon={FileTextIcon} size={14} />
                <span>{picked.name}</span>
                <ActionIcon icon={XIcon} size={'small'} onClick={() => setPicked(undefined)} />
              </Flexbox>
            ) : (
              <>
                <TextArea
                  autoSize={{ maxRows: 14, minRows: 8 }}
                  placeholder={t('rules.distill.textPlaceholder')}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <Flexbox horizontal align={'center'} gap={8}>
                  <input
                    hidden
                    accept={'.md,.markdown,.txt,.pdf,.doc,.docx,.pptx,.csv,.json,.ipynb'}
                    ref={fileInput}
                    type={'file'}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void upload(file);
                    }}
                  />
                  <Button
                    icon={<Icon icon={UploadIcon} />}
                    loading={uploading}
                    size={'small'}
                    onClick={() => fileInput.current?.click()}
                  >
                    {t('rules.distill.upload')}
                  </Button>
                  <Text fontSize={12} type={'secondary'}>
                    {t('rules.distill.uploadHint')}
                  </Text>
                </Flexbox>
              </>
            ))}
          {tab === 'document' && (
            <div className={styles.options}>
              {recentPages.error ? (
                loadFailed(recentPages.retry)
              ) : !pages ? (
                <Spin size={'small'} />
              ) : pages.length === 0 ? (
                <Text type={'secondary'}>{t('rules.distill.noDocuments')}</Text>
              ) : (
                pages.map((page) =>
                  optionRow(page.id, page.name, dayjs(page.updatedAt).format('YYYY-MM-DD'), () =>
                    setPicked({ name: page.name, source: { id: page.id, type: 'document' } }),
                  ),
                )
              )}
            </div>
          )}
          {tab === 'file' && (
            <Flexbox horizontal align={'center'} gap={8}>
              <Button
                icon={<Icon icon={LibraryIcon} />}
                onClick={() =>
                  openLibraryFilePicker((attachments) => {
                    const [first] = attachments;
                    if (first)
                      setPicked({ name: first.name, source: { id: first.fileId, type: 'file' } });
                  })
                }
              >
                {t('rules.distill.pickFile')}
              </Button>
              {picked && (
                <Flexbox horizontal align={'center'} gap={6}>
                  <Icon icon={FileTextIcon} size={14} />
                  <span>{picked.name}</span>
                </Flexbox>
              )}
            </Flexbox>
          )}
          {tab === 'topic' && (
            <>
              <Input
                placeholder={t('rules.distill.searchTopic')}
                prefix={<Icon icon={MessageSquareTextIcon} size={14} />}
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
              />
              <div className={styles.options}>
                {topicList.error ? (
                  loadFailed(topicList.retry)
                ) : !topics ? (
                  <Spin size={'small'} />
                ) : topics.length === 0 ? (
                  <Text type={'secondary'}>{t('rules.distill.noTopics')}</Text>
                ) : (
                  topics.map((topic) =>
                    optionRow(topic.id, topic.title, topic.agent, () =>
                      setPicked({ name: topic.title, source: { id: topic.id, type: 'topic' } }),
                    ),
                  )
                )}
              </div>
            </>
          )}
        </Flexbox>
      )}

      {step === 'reading' && (
        <Flexbox className={composeStyles.body} gap={10}>
          <GeneratingBorder generating className={composeStyles.inputShell}>
            <Flexbox gap={6} padding={16}>
              <Text weight={500}>{source?.name}</Text>
              <Flexbox horizontal align={'center'} gap={8}>
                <Spin size={'small'} variant={'network'} />
                <span className={shinyTextStyles.shinyText}>{t('rules.distill.reading')}</span>
              </Flexbox>
            </Flexbox>
          </GeneratingBorder>
        </Flexbox>
      )}

      {step === 'review' && result && (
        <Flexbox className={composeStyles.body}>
          {result.material.truncated && (
            <Text fontSize={12} type={'warning'}>
              {t('rules.distill.truncated')}
            </Text>
          )}
          {drafts.length === 0 ? (
            <Text type={'secondary'}>{t('rules.distill.none')}</Text>
          ) : (
            drafts.map((draft, index) => {
              const { candidate } = draft;
              const duplicate = titleOf(candidate.duplicateOf);
              return (
                <div
                  className={cx(styles.candidate, !draft.keep && styles.candidateOff)}
                  key={index}
                >
                  <Checkbox
                    checked={draft.keep}
                    style={{ marginTop: 6 }}
                    onChange={(checked) => patch(index, { keep: Boolean(checked) })}
                  />
                  <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
                    {duplicate ? (
                      <Text weight={500}>{duplicate}</Text>
                    ) : (
                      <Input
                        className={styles.titleInput}
                        value={draft.title}
                        variant={'borderless'}
                        onChange={(e) => patch(index, { title: e.target.value })}
                      />
                    )}
                    {duplicate && (
                      <span className={styles.duplicate}>{t('rules.distill.duplicate')}</span>
                    )}
                    {candidate.quote && <p className={styles.quote}>{candidate.quote}</p>}
                    {!duplicate && (
                      <Flexbox horizontal align={'center'} gap={4}>
                        <DropdownMenu
                          items={[
                            ...groups.map((group) => ({
                              key: group.domain.id,
                              label: group.domain.title,
                              onClick: () => patch(index, { groupId: group.domain.id }),
                            })),
                            ...(canOpenGroup && candidate.newGroup
                              ? [
                                  {
                                    key: 'new',
                                    label: t('rules.distill.newGroup', {
                                      title: candidate.newGroup.title,
                                    }),
                                    onClick: () => patch(index, { groupId: 'new' }),
                                  },
                                ]
                              : []),
                          ]}
                        >
                          <span className={styles.chip}>
                            <Icon
                              icon={draft.groupId === 'new' ? FolderPlusIcon : FolderIcon}
                              size={12}
                            />
                            {groupTitle(draft.groupId, candidate)}
                            <Icon icon={ChevronDownIcon} size={12} />
                          </span>
                        </DropdownMenu>
                        <span
                          className={styles.chip}
                          onClick={() =>
                            patch(index, {
                              enforcement: draft.enforcement === 'block' ? 'remind' : 'block',
                            })
                          }
                        >
                          <Icon
                            icon={draft.enforcement === 'block' ? ShieldCheckIcon : BellIcon}
                            size={12}
                          />
                          {t(
                            draft.enforcement === 'block'
                              ? 'rules.enforcement.block'
                              : 'rules.enforcement.remind',
                          )}
                        </span>
                      </Flexbox>
                    )}
                  </Flexbox>
                </div>
              );
            })
          )}
        </Flexbox>
      )}

      <Flexbox
        horizontal
        align={'center'}
        className={composeStyles.footer}
        gap={8}
        justify={'flex-end'}
      >
        {step === 'review' ? (
          <Button
            disabled={kept.length === 0}
            loading={saving}
            type={'primary'}
            onClick={() => void save()}
          >
            {t('rules.distill.save', { count: kept.length })}
          </Button>
        ) : (
          <Button
            disabled={!source || uploading}
            loading={step === 'reading'}
            type={'primary'}
            onClick={() => void read()}
          >
            {t('rules.distill.read')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
};

export const createDistillModal = (props: DistillContentProps) =>
  createModal({
    content: <DistillContent {...props} />,
    footer: null,
    maskClosable: false,
    styles: { content: { overflow: 'hidden', padding: 0 } },
    title: null,
    width: 'min(88vw, 720px)',
  });
