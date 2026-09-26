'use client';

import type { ExpertiseEnforcement, ExpertiseReasonKind } from '@lobechat/types';
import { Block, Flexbox, Icon, TextArea } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  type DropdownItem,
  DropdownMenu,
  Tag,
  Text,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import {
  ActivityIcon,
  BellIcon,
  ClipboardCheckIcon,
  HistoryIcon,
  type LucideIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ScaleIcon,
  ShieldCheckIcon,
  TargetIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import RightPanel from '@/features/RightPanel';
import type { RuleGroup, RuleItem, UpdateRuleInput } from '@/services/expertise';

import Field from './Field';
import { useRuleRevisions, useRuleSources } from './hooks';
import { mergedIntoId, sectionBody, useScopeLabel } from './labels';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    flex: 1;
    padding-block: 4px 24px;
    padding-inline: 28px;
  `,
  foot: css`
    flex: none;
    padding-block: 12px;
    padding-inline: 28px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  head: css`
    flex: none;
    padding-block: 24px 0;
    padding-inline: 28px;
  `,
  heading: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    margin-block: 22px 6px;

    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};
    letter-spacing: 0.02em;
  `,
  kicker: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  link: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  muted: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  properties: css`
    display: flex;
    flex-direction: column;
    gap: 2px;

    margin-block-start: 16px;
    padding-block-end: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  property: css`
    width: 100%;
    min-height: 30px;
    padding-block: 5px;
    padding-inline: 8px 10px;
    border-radius: ${cssVar.borderRadius};

    font-size: 13px;
  `,
  propertyLabel: css`
    flex: none;
    width: 44px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  propertyStatic: css`
    background: transparent;
  `,
  quote: css`
    margin-block: 6px 0;
    padding-block: 6px;
    padding-inline: 12px 0;
    border-inline-start: 2px solid ${cssVar.colorBorder};

    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  source: css`
    padding-block: 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  title: css`
    font-size: 20px;
    font-weight: 600;
    line-height: 1.35;
    text-wrap: pretty;
  `,
  titleInput: css`
    box-sizing: border-box;
    width: 100%;
    padding: 0;
    border: none;

    font-family: inherit;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.35;
    color: inherit;

    background: transparent;
    outline: none;
  `,
  warning: css`
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorWarningText};

    background: ${cssVar.colorWarningBg};
  `,
}));

interface PropertyProps {
  children: ReactNode;
  icon: LucideIcon;
  label: string;
  menu?: DropdownItem[];
}

/**
 * One property line, in the shape the task detail uses: a label, an icon, the current value, and
 * a menu behind the click when it can be changed. Read-only lines drop the fill so the eye finds
 * the switches first.
 */
const Property = ({ children, icon, label, menu }: PropertyProps) => {
  const row = (
    <Block
      horizontal
      align={'center'}
      className={cx(styles.property, !menu && styles.propertyStatic)}
      clickable={Boolean(menu)}
      gap={8}
      variant={menu ? 'filled' : 'borderless'}
    >
      <span className={styles.propertyLabel}>{label}</span>
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
  onUpdate: (patch: UpdateRuleInput) => Promise<unknown>;
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
  const { data: sources } = useRuleSources(rule.id);
  const { data: revisions, mutate: mutateRevisions } = useRuleRevisions(rule.id);
  const [exception, setException] = useState('');
  const [titleDraft, setTitleDraft] = useState(rule.title);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitleDraft(rule.title);
  }, [rule.id, rule.title, titleEditing]);

  const archived = rule.status === 'retired';
  const authored = Boolean(rule.createdByUserId) && rule.hitCount === 0;
  const all = groups.flatMap((g) => g.rules);
  const titleOf = (id: string) => all.find((r) => r.id === id)?.title ?? id;
  const mergedInto = mergedIntoId(rule);

  const save = async (patch: UpdateRuleInput) => {
    if (busy) return;
    setBusy(true);
    try {
      await onUpdate(patch);
      await mutateRevisions();
    } finally {
      setBusy(false);
    }
  };

  const commitTitle = () => {
    const next = titleDraft.trim();
    onTitleEditing(false);
    if (next && next !== rule.title) void save({ title: next });
  };

  const addException = () => {
    const text = exception.trim();
    if (!text) return;
    void save({ sections: { limits: text } }).then(() => setException(''));
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
      <div className={styles.head}>
        <Flexbox horizontal align={'flex-start'} gap={8}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={styles.kicker}>
              {code} · {group?.domain.title}
              {rule.tags?.length ? ` · ${rule.tags.join(' / ')}` : ''}
            </div>
            {titleEditing ? (
              <input
                autoFocus
                className={styles.titleInput}
                value={titleDraft}
                onBlur={commitTitle}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTitle();
                  if (e.key === 'Escape') onTitleEditing(false);
                }}
              />
            ) : (
              <div className={styles.title}>{rule.title}</div>
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

        <div className={styles.properties}>
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
            <span className={styles.muted}>
              {t(
                rule.enforcement === 'block'
                  ? 'rules.enforcement.blockDesc'
                  : 'rules.enforcement.remindDesc',
              )}
            </span>
          </Property>
          <Property
            icon={ClipboardCheckIcon}
            label={t('rules.meta.method')}
            menu={
              editable
                ? choose(
                    ['compiled', 'compilable', 'not-compilable'] as const,
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
            <Text weight={500}>{t(`rules.reason.${rule.reasonKind ?? 'taste'}`)}</Text>
            <span className={styles.muted}>
              {t(
                rule.reasonSource === 'inferred'
                  ? 'rules.reason.inferred'
                  : 'rules.reason.reviewer',
              )}
            </span>
          </Property>
          {rule.enforcement === 'block' && rule.reasonKind === 'taste' && (
            <div className={styles.warning}>{t('rules.enforcement.tasteWarning')}</div>
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
                <span className={styles.muted}>
                  {' · '}
                  {t('rules.runs.overruled', { count: rule.falsePositiveCount })}
                </span>
              )}
            </span>
          </Property>
          <Property icon={HistoryIcon} label={t('rules.meta.origin')}>
            <span>
              {authored
                ? t('rules.origin.authored')
                : t('rules.origin.distilled', { hits: rule.hitCount }) +
                  (rule.lastHitAt
                    ? t('rules.origin.lastHit', { time: dayjs(rule.lastHitAt).fromNow() })
                    : '')}
            </span>
            {Boolean(rule.generalizedFromIds?.length) && (
              <span className={styles.muted}>
                {t('rules.origin.generalizedFrom', {
                  titles: rule.generalizedFromIds!.map(titleOf).join('」「'),
                })}
              </span>
            )}
            {rule.specificity === 'over-specific' && (
              <span className={styles.muted}>{t('rules.origin.overSpecific')}</span>
            )}
            {rule.specificity === 'one-off' && (
              <span className={styles.muted}>{t('rules.origin.oneOff')}</span>
            )}
            {archived && (
              <span className={styles.muted}>
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

      <div className={styles.body}>
        <Field
          editable={!archived}
          label={t('rules.field.why')}
          placeholder={t('rules.field.whyEmpty')}
          value={sectionBody(rule, 'why')}
          onSave={(why) => void save({ sections: { why: why || null } })}
        />
        <Field
          editable={!archived}
          label={t('rules.field.how')}
          placeholder={t('rules.field.howEmpty')}
          value={sectionBody(rule, 'how')}
          onSave={(how) => void save({ sections: { how: how || null } })}
        />
        <Field
          editable={!archived}
          label={t('rules.field.limits')}
          placeholder={t('rules.field.limitsEmpty')}
          value={sectionBody(rule, 'limits')}
          onSave={(next) => void save({ sections: { limits: next || null } })}
        />
        <Field
          muted
          label={`${t('rules.field.check')} · ${t(`rules.method.${rule.compilability}`)}`}
          placeholder={t('rules.field.checkPending')}
        />

        <div className={styles.heading}>
          <span>{t('rules.sources.title')}</span>
        </div>
        {sources?.length ? (
          sources.map((source) => (
            <div className={styles.source} key={source.id}>
              <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
                  <Tag size={'small'}>{t('rules.sources.acceptance')}</Tag>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    {source.checkTitle ?? source.where ?? ''}
                  </span>
                </Flexbox>
                {source.acceptanceId && (
                  <a
                    className={styles.link}
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
                <p className={styles.quote}>{source.reviewerComment || source.example}</p>
              )}
              <div className={styles.muted}>
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
          <p className={styles.muted}>
            {t(authored ? 'rules.sources.authoredEmpty' : 'rules.sources.empty')}
          </p>
        )}

        {Boolean(revisions?.length) && (
          <>
            <div className={styles.heading}>
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
                  <div className={styles.muted}>
                    {t('rules.revisions.prevTitle', { title: revision.prevTitle })}
                  </div>
                )}
                <div className={styles.muted}>
                  {t(
                    revision.changedBy === 'user'
                      ? 'rules.revisions.byYou'
                      : 'rules.revisions.bySystem',
                  )}
                  {' · '}
                  {dayjs(revision.createdAt).format('YYYY-MM-DD')}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {!archived && (
        <Flexbox horizontal align={'flex-end'} className={styles.foot} gap={8}>
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
    defaultWidth={440}
    expand={Boolean(rule)}
    maxWidth={760}
    minWidth={380}
    onExpandChange={(next) => !next && onClose()}
  >
    {rule ? <RuleDocument code={code ?? ''} rule={rule} {...rest} /> : null}
  </RightPanel>
);

export default DetailPanel;
