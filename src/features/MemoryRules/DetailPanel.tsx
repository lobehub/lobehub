'use client';

import {
  EXPERTISE_RULE_DIRECTIONS,
  type ExpertiseEnforcement,
  type ExpertiseReasonKind,
} from '@lobechat/types';
import { Block, Flexbox, Icon } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  type DropdownItem,
  DropdownMenu,
  SkeletonText,
  Tag,
  Text,
  TextArea,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import {
  ActivityIcon,
  BellIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  HistoryIcon,
  type LucideIcon,
  MessageSquareTextIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ScaleIcon,
  ShieldCheckIcon,
  TargetIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { docsFilePath, docsPagePath } from '@/features/ResourceHome/paths';
import RightPanel from '@/features/RightPanel';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import type { RuleGroup, RuleItem, UpdateRuleInput } from '@/services/expertise';

import { DIRECTION_ICON } from './DirectionToggle';
import Field from './Field';
import { useRuleRevisions, useRuleSources } from './hooks';
import {
  appendException,
  mergedIntoId,
  revisionAuthorKey,
  ruleOrigin,
  sectionBody,
  useScopeLabel,
} from './labels';

const styles = stylex.create({
  body: {
    overflowY: 'auto',
    flex: '1',
    paddingBlockStart: '4px',
    paddingBlockEnd: '24px',
    paddingInline: '28px',
  },
  foot: {
    flex: 'none',
    paddingBlock: '12px',
    paddingInline: '28px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  head: { flex: 'none', paddingBlockStart: '24px', paddingBlockEnd: '0', paddingInline: '28px' },
  heading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBlockStart: '22px',
    marginBlockEnd: '6px',
    fontSize: '12px',
    fontWeight: 600,
    color: cssVar.colorTextTertiary,
    letterSpacing: '0.02em',
  },
  kicker: { fontFamily: cssVar.fontFamilyCode, fontSize: '12px', color: cssVar.colorTextSecondary },
  link: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    textDecoration: 'none',
  },
  muted: { fontSize: '12px', lineHeight: 1.6, color: cssVar.colorTextSecondary },
  properties: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    marginBlockStart: '16px',
    paddingBlockEnd: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  property: {
    width: '100%',
    minHeight: '30px',
    paddingBlock: '5px',
    paddingInlineStart: '8px',
    paddingInlineEnd: '10px',
    borderRadius: cssVar.borderRadius,
    fontSize: '13px',
  },
  propertyLabel: { flex: 'none', width: '44px', fontSize: '12px', color: cssVar.colorTextTertiary },
  propertyStatic: { backgroundColor: 'transparent', backgroundImage: 'none' },
  quote: {
    marginBlockStart: '6px',
    marginBlockEnd: '0',
    paddingBlock: '6px',
    paddingInlineStart: '12px',
    paddingInlineEnd: '0',
    borderInlineStartWidth: '2px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorder,
    fontSize: '13px',
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
  },
  source: {
    paddingBlock: '10px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: { 'default': 'solid', ':last-child': 'none' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  title: { fontSize: '20px', fontWeight: 600, lineHeight: 1.35, textWrap: 'pretty' },
  titleInput: {
    boxSizing: 'border-box',
    width: '100%',
    padding: '0',
    borderStyle: 'none',
    fontFamily: 'inherit',
    fontSize: '20px',
    fontWeight: 600,
    lineHeight: 1.35,
    color: 'inherit',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    outlineStyle: 'none',
  },
  warning: {
    paddingBlock: '6px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    fontSize: '12px',
    lineHeight: 1.6,
    color: cssVar.colorWarningText,
    backgroundColor: cssVar.colorWarningBg,
    backgroundImage: 'none',
  },
});

interface PropertyProps {
  children: ReactNode;
  icon: LucideIcon;
  label: string;
  menu?: DropdownItem[];
}

/**
 * One property line, in the shape the task detail uses: a label, an icon, the current value, and
 * a menu behind the click when it can be changed. Every line sits on the same plain ground; the
 * ones that open a menu only light up on hover, so the block does not read as a highlight.
 */
const Property = ({ children, icon, label, menu }: PropertyProps) => {
  const row = (
    <Block
      horizontal
      align={'center'}
      className={stylex.props(styles.property, !menu && styles.propertyStatic).className}
      clickable={Boolean(menu)}
      gap={8}
      variant={'borderless'}
    >
      <span {...stylex.props(styles.propertyLabel)}>{label}</span>
      <Icon color={cssVar.colorTextSecondary} icon={icon} size={14} />
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        {children}
      </Flexbox>
    </Block>
  );
  return menu ? <DropdownMenu items={menu}>{row}</DropdownMenu> : row;
};

interface RuleDocumentProps {
  code: string;
  group?: RuleGroup;
  groups: RuleGroup[];
  menu: DropdownItem[];
  onTitleEditing: (editing: boolean) => void;
  /** Resolves to whether the change was saved. */
  onUpdate: (patch: UpdateRuleInput) => Promise<boolean>;
  rule: RuleItem;
  titleEditing: boolean;
}

/**
 * The rule as a document: the sentence itself as the title (editable in place), its settings as
 * property lines, then the sections a lesson row carries, the evidence it grew from, and the
 * edits it has been through. The exception composer is docked at the foot so a long source list
 * never pushes it out of a short window.
 */
const RuleDocument = ({
  code,
  group,
  groups,
  menu,
  onTitleEditing,
  onUpdate,
  rule,
  titleEditing,
}: RuleDocumentProps) => {
  const { t } = useTranslation('memory');
  const scopeLabel = useScopeLabel();
  const navigate = useNavigate();
  const workspaceSlug = useActiveWorkspaceSlug();
  const {
    data: sources,
    error: sourcesError,
    isLoading: sourcesLoading,
    mutate: retrySources,
  } = useRuleSources(rule.id);
  const { data: revisions, mutate: mutateRevisions } = useRuleRevisions(rule.id);
  const [exception, setException] = useState('');
  const [titleDraft, setTitleDraft] = useState(rule.title);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitleDraft(rule.title);
  }, [rule.id, rule.title, titleEditing]);

  const archived = rule.status === 'retired';
  const authored = rule.authored;
  const all = groups.flatMap((g) => g.rules);
  const titleOf = (id: string) => all.find((r) => r.id === id)?.title ?? id;
  const mergedInto = mergedIntoId(rule);
  const origin = ruleOrigin(rule);
  // What the reviewer wrote into an agent's lessons was taught to that agent, not a rule of theirs.
  const taught = authored && group?.owner.kind === 'agent';

  const save = async (patch: UpdateRuleInput) => {
    if (busy) return false;
    setBusy(true);
    try {
      const saved = await onUpdate(patch);
      if (saved) await mutateRevisions();
      return saved;
    } finally {
      setBusy(false);
    }
  };

  const commitTitle = async () => {
    const next = titleDraft.trim();
    if (!next || next === rule.title) return onTitleEditing(false);
    // Leave edit mode only once the rename is saved; on failure the draft stays to retry.
    if (await save({ title: next })) onTitleEditing(false);
  };

  const addException = () => {
    const text = exception.trim();
    if (!text) return;
    // Keep what they typed if the save did not land.
    void save({ sections: { limits: appendException(sectionBody(rule, 'limits'), text) } }).then(
      (saved) => saved && setException(''),
    );
  };

  const choose = <T extends string>(
    values: readonly T[],
    label: (value: T) => string,
    onPick: (value: T) => void,
  ): DropdownItem[] =>
    values.map((value) => ({ key: value, label: label(value), onClick: () => onPick(value) }));
  const editable = !archived && !busy;

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <div {...stylex.props(styles.head)}>
        <Flexbox horizontal align={'flex-start'} gap={8}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div {...stylex.props(styles.kicker)}>
              {code} · {group?.domain.title}
              {rule.tags?.length ? ` · ${rule.tags.join(' / ')}` : ''}
            </div>
            {titleEditing ? (
              <input
                autoFocus
                {...stylex.props(styles.titleInput)}
                value={titleDraft}
                onBlur={() => void commitTitle()}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitTitle();
                  if (e.key === 'Escape') onTitleEditing(false);
                }}
              />
            ) : (
              <div {...stylex.props(styles.title)}>{rule.title}</div>
            )}
          </div>
          {!archived && !titleEditing && (
            <ActionIcon
              icon={PencilIcon}
              size={'small'}
              title={t('rules.actions.edit')}
              onClick={() => onTitleEditing(true)}
            />
          )}
          <DropdownMenu items={menu}>
            <ActionIcon disabled={busy} icon={MoreHorizontalIcon} size={'small'} />
          </DropdownMenu>
        </Flexbox>

        <div {...stylex.props(styles.properties)}>
          <Property
            icon={rule.enforcement === 'block' ? ShieldCheckIcon : BellIcon}
            label={t('rules.meta.enforcement')}
            menu={
              editable
                ? choose(
                    ['block', 'remind'] as const,
                    (value) =>
                      t(
                        value === 'block'
                          ? 'rules.compose.enforcementBlock'
                          : 'rules.compose.enforcementRemind',
                      ),
                    (enforcement: ExpertiseEnforcement) => void save({ enforcement }),
                  )
                : undefined
            }
          >
            <Text weight={500}>
              {t(
                rule.enforcement === 'block'
                  ? 'rules.enforcement.block'
                  : 'rules.enforcement.remind',
              )}
            </Text>
            <span {...stylex.props(styles.muted)}>
              {t(
                rule.enforcement === 'block'
                  ? 'rules.enforcement.blockDesc'
                  : 'rules.enforcement.remindDesc',
              )}
            </span>
          </Property>
          <Property
            icon={DIRECTION_ICON[rule.direction ?? 'unset']}
            label={t('rules.meta.direction')}
            menu={
              editable
                ? choose(
                    EXPERTISE_RULE_DIRECTIONS,
                    (value) => t(`rules.direction.${value}`),
                    (direction) => void save({ direction }),
                  )
                : undefined
            }
          >
            <Text weight={500}>{t(`rules.direction.${rule.direction ?? 'unset'}`)}</Text>
            <span {...stylex.props(styles.muted)}>
              {t(`rules.direction.${rule.direction ?? 'unset'}Desc`)}
            </span>
          </Property>
          <Property
            icon={ClipboardCheckIcon}
            label={t('rules.meta.method')}
            menu={
              // `compiled` is set by the compiler once a criterion is linked; the reviewer can only
              // say whether a program could check it.
              editable && rule.compilability !== 'compiled'
                ? choose(
                    ['compilable', 'not-compilable'] as const,
                    (value) => t(`rules.method.${value}`),
                    (compilability) => void save({ compilability }),
                  )
                : undefined
            }
          >
            <Text weight={500}>{t(`rules.method.${rule.compilability}`)}</Text>
          </Property>
          <Property
            icon={ScaleIcon}
            label={t('rules.meta.reason')}
            menu={
              editable
                ? choose(
                    ['mechanism', 'taste'] as const,
                    (value) => t(`rules.reason.${value}`),
                    (reasonKind: ExpertiseReasonKind) => void save({ reasonKind }),
                  )
                : undefined
            }
          >
            {/* Conversation learning never classifies its reason; saying "taste, you said it"
                for those would claim something nobody stated. */}
            <Text weight={500}>{t(`rules.reason.${rule.reasonKind ?? 'unset'}`)}</Text>
            {rule.reasonSource && (
              <span {...stylex.props(styles.muted)}>{t(`rules.reason.${rule.reasonSource}`)}</span>
            )}
          </Property>
          {rule.enforcement === 'block' && rule.reasonKind === 'taste' && (
            <div {...stylex.props(styles.warning)}>{t('rules.enforcement.tasteWarning')}</div>
          )}
          <Property icon={TargetIcon} label={t('rules.meta.scope')}>
            <span>{group ? scopeLabel(group.scopes) : ''}</span>
          </Property>
          <Property icon={ActivityIcon} label={t('rules.meta.runs')}>
            <span>
              {rule.hitRunCount
                ? t('rules.runs.detail', { hits: rule.hitCount, runs: rule.hitRunCount })
                : t('rules.runs.none')}
              {rule.falsePositiveCount > 0 && (
                <span {...stylex.props(styles.muted)}>
                  {' · '}
                  {t('rules.runs.overruled', { count: rule.falsePositiveCount })}
                </span>
              )}
            </span>
          </Property>
          <Property icon={HistoryIcon} label={t('rules.meta.origin')}>
            <span>
              {taught
                ? t('rules.origin.taught')
                : t(`rules.origin.${origin.key}`, 'params' in origin ? origin.params : undefined)}
              {!authored && rule.lastHitAt
                ? t('rules.origin.lastHit', { time: dayjs(rule.lastHitAt).fromNow() })
                : ''}
            </span>
            {Boolean(rule.generalizedFromIds?.length) && (
              <span {...stylex.props(styles.muted)}>
                {t('rules.origin.generalizedFrom', {
                  titles: rule.generalizedFromIds!.map(titleOf).join('」「'),
                })}
              </span>
            )}
            {rule.specificity === 'over-specific' && (
              <span {...stylex.props(styles.muted)}>{t('rules.origin.overSpecific')}</span>
            )}
            {rule.specificity === 'one-off' && (
              <span {...stylex.props(styles.muted)}>{t('rules.origin.oneOff')}</span>
            )}
            {archived && (
              <span {...stylex.props(styles.muted)}>
                {t('rules.archived.at', {
                  time: dayjs(rule.retiredAt ?? undefined).format('YYYY-MM-DD'),
                })}
                {' · '}
                {mergedInto
                  ? t('rules.archived.mergedInto', { title: titleOf(mergedInto) })
                  : t('rules.archived.byYou')}
              </span>
            )}
          </Property>
        </div>
      </div>

      <div {...stylex.props(styles.body)}>
        <Field
          editable={!archived}
          label={t('rules.field.why')}
          placeholder={t('rules.field.whyEmpty')}
          value={sectionBody(rule, 'why')}
          onSave={(why) => save({ sections: { why: why || null } })}
        />
        <Field
          editable={!archived}
          label={t('rules.field.how')}
          placeholder={t('rules.field.howEmpty')}
          value={sectionBody(rule, 'how')}
          onSave={(how) => save({ sections: { how: how || null } })}
        />
        <Field
          editable={!archived}
          label={t('rules.field.limits')}
          placeholder={t('rules.field.limitsEmpty')}
          value={sectionBody(rule, 'limits')}
          onSave={(next) => save({ sections: { limits: next || null } })}
        />
        <Field
          muted
          label={`${t('rules.field.check')} · ${t(`rules.method.${rule.compilability}`)}`}
          placeholder={t('rules.field.checkPending')}
        />

        <div {...stylex.props(styles.heading)}>
          <span>{t('rules.sources.title')}</span>
        </div>
        {/* "No sources" is only said once the list has actually come back empty; loading and a
            failed request each say what they are, so nothing reads as lost evidence. */}
        {sourcesLoading && !sources ? (
          <SkeletonText rows={2} />
        ) : sourcesError && !sources ? (
          <Flexbox horizontal align={'center'} gap={8}>
            <span {...stylex.props(styles.muted)}>{t('rules.sources.loadFailed')}</span>
            <Button size={'small'} type={'link'} onClick={() => void retrySources()}>
              {t('rules.sources.retry')}
            </Button>
          </Flexbox>
        ) : sources?.length ? (
          sources.map((source) => (
            <div {...stylex.props(styles.source)} key={source.id}>
              <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
                  <Tag size={'small'}>
                    {t(
                      source.fromAcceptance
                        ? 'rules.sources.acceptance'
                        : source.materialType
                          ? `rules.sources.material.${source.materialType as 'document' | 'file' | 'text' | 'topic'}`
                          : 'rules.sources.conversation',
                    )}
                  </Tag>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    {source.checkTitle ?? source.where ?? ''}
                  </span>
                </Flexbox>
                {!source.fromAcceptance && source.topicId && source.topicAgentId && (
                  <a
                    {...stylex.props(styles.link)}
                    href={buildWorkspaceAwarePath(
                      `/agent/${source.topicAgentId}/${source.topicId}${
                        source.messageId ? `?locate=${source.messageId}` : ''
                      }`,
                      workspaceSlug,
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(e.currentTarget.getAttribute('href')!);
                    }}
                  >
                    <Icon icon={MessageSquareTextIcon} size={12} />
                    {t(source.messageId ? 'rules.sources.openMessage' : 'rules.sources.openTopic')}
                  </a>
                )}
                {/* A document or file it was read from opens where the reviewer keeps it. */}
                {source.documentId && (
                  <a
                    {...stylex.props(styles.link)}
                    href={buildWorkspaceAwarePath(
                      source.documentFileId
                        ? docsFilePath(source.documentFileId)
                        : docsPagePath(source.documentId),
                      workspaceSlug,
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(e.currentTarget.getAttribute('href')!);
                    }}
                  >
                    <Icon icon={FileTextIcon} size={12} />
                    {t('rules.sources.openMaterial')}
                  </a>
                )}
                {source.acceptanceId && (
                  <a
                    {...stylex.props(styles.link)}
                    href={`/acceptance/${source.acceptanceId}`}
                    rel={'noreferrer'}
                    target={'_blank'}
                  >
                    <Icon icon={ClipboardCheckIcon} size={12} />
                    {t('rules.sources.open')}
                  </a>
                )}
              </Flexbox>
              {(source.reviewerComment || source.example) && (
                <p {...stylex.props(styles.quote)}>{source.reviewerComment || source.example}</p>
              )}
              <div {...stylex.props(styles.muted)}>
                {dayjs(source.createdAt).format('YYYY-MM-DD')}
                {source.roundIndex
                  ? ` · ${t('rules.sources.round', { index: source.roundIndex })}`
                  : ''}
                {source.severity ? ` · ${t(`rules.severity.${source.severity}`)}` : ''}
                {source.userDecision === 'agree' ? ` · ${t('rules.sources.agreed')}` : ''}
                {source.userDecision === 'reject' ? ` · ${t('rules.sources.rejected')}` : ''}
              </div>
            </div>
          ))
        ) : (
          <p {...stylex.props(styles.muted)}>
            {t(
              taught
                ? 'rules.sources.taughtEmpty'
                : authored
                  ? 'rules.sources.authoredEmpty'
                  : 'rules.sources.empty',
            )}
          </p>
        )}

        {Boolean(revisions?.length) && (
          <>
            <div {...stylex.props(styles.heading)}>
              <span>{t('rules.revisions.title')}</span>
            </div>
            {revisions!.map((revision) => (
              <div key={revision.id} style={{ marginBottom: 10 }}>
                <Text fontSize={13}>
                  {revision.kind === 'generalize'
                    ? t('rules.revisions.generalize', { title: revision.feedback ?? '' })
                    : revision.feedback}
                </Text>
                {revision.prevTitle && (
                  <div {...stylex.props(styles.muted)}>
                    {t('rules.revisions.prevTitle', { title: revision.prevTitle })}
                  </div>
                )}
                <div {...stylex.props(styles.muted)}>
                  {t(revisionAuthorKey(revision))}
                  {' · '}
                  {dayjs(revision.createdAt).format('YYYY-MM-DD')}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {!archived && (
        <Flexbox
          horizontal
          align={'flex-end'}
          className={stylex.props(styles.foot).className}
          gap={8}
        >
          <TextArea
            autoSize={{ maxRows: 4, minRows: 1 }}
            disabled={busy}
            placeholder={t('rules.exception.placeholder')}
            style={{ flex: 1 }}
            value={exception}
            onChange={(e) => setException(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') addException();
            }}
          />
          <Button
            disabled={!exception.trim()}
            loading={busy}
            type={'primary'}
            onClick={addException}
          >
            {t('rules.exception.submit')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
};

interface DetailPanelProps extends Omit<RuleDocumentProps, 'rule' | 'code'> {
  code?: string;
  onClose: () => void;
  rule?: RuleItem;
}

/**
 * The same draggable right panel the sibling memory surfaces use. Its visibility follows the
 * selection: until a rule is picked there is nothing to show, and an empty column is not worth
 * the width.
 */
const DetailPanel = ({ code, onClose, rule, ...rest }: DetailPanelProps) => (
  <RightPanel
    expandFollowsSelection
    defaultWidth={440}
    expand={Boolean(rule)}
    maxWidth={760}
    minWidth={380}
    onExpandChange={(next) => !next && onClose()}
  >
    {/* Keyed by rule: every draft in the document belongs to one rule and must not carry over. */}
    {rule ? <RuleDocument code={code ?? ''} key={rule.id} rule={rule} {...rest} /> : null}
  </RightPanel>
);

export default DetailPanel;
