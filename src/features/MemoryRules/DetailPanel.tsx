'use client';

import type { ExpertiseEnforcement, ExpertiseReasonKind } from '@lobechat/types';
import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  type DropdownItem,
  DropdownMenu,
  Segmented,
  Tag,
  Text,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { ClipboardCheckIcon, MoreHorizontalIcon } from 'lucide-react';
import { useState } from 'react';
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
    padding-block: 8px 24px;
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
  meta: css`
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: 8px 12px;

    margin-block-start: 14px;
    padding-block: 12px;
    border-block: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 12.5px;

    dt {
      color: ${cssVar.colorTextTertiary};
    }

    dd {
      margin: 0;
      color: ${cssVar.colorText};
    }
  `,
  muted: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
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
}));

interface RuleDocumentProps {
  code: string;
  group?: RuleGroup;
  groups: RuleGroup[];
  menu: DropdownItem[];
  onUpdate: (patch: UpdateRuleInput) => Promise<unknown>;
  rule: RuleItem;
}

/**
 * The rule as a document: a heading per column of the lesson row, each editable on its own, with
 * the evidence it grew from and the edits it has been through underneath. The exception composer
 * is docked at the foot so a long source list never pushes it out of a short window.
 */
const RuleDocument = ({ code, group, groups, menu, onUpdate, rule }: RuleDocumentProps) => {
  const { t } = useTranslation('memory');
  const scopeLabel = useScopeLabel();
  const { data: sources } = useRuleSources(rule.id);
  const { data: revisions, mutate: mutateRevisions } = useRuleRevisions(rule.id);
  const [exception, setException] = useState('');
  const [busy, setBusy] = useState(false);

  const archived = rule.status === 'retired';
  const authored = Boolean(rule.createdByUserId) && rule.hitCount === 0;
  const limits = sectionBody(rule, 'limits');
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

  const addException = () => {
    const text = exception.trim();
    if (!text) return;
    void save({ sections: { limits: text } }).then(() => setException(''));
  };

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <div className={styles.head}>
        <Flexbox horizontal align={'flex-start'} gap={8}>
          <div style={{ flex: 1 }}>
            <div className={styles.kicker}>
              {code} · {group?.domain.title}
              {rule.tags?.length ? ` · ${rule.tags.join(' / ')}` : ''}
            </div>
            <div className={styles.title}>{rule.title}</div>
          </div>
          <DropdownMenu items={menu}>
            <ActionIcon disabled={busy} icon={MoreHorizontalIcon} size={'small'} />
          </DropdownMenu>
        </Flexbox>
        <dl className={styles.meta}>
          <dt>{t('rules.meta.enforcement')}</dt>
          <dd>
            <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
              <Segmented<ExpertiseEnforcement>
                disabled={archived || busy}
                size={'small'}
                value={rule.enforcement}
                options={[
                  { label: t('rules.enforcement.remind'), value: 'remind' },
                  { label: t('rules.enforcement.block'), value: 'block' },
                ]}
                onChange={(enforcement) => void save({ enforcement })}
              />
              <span className={styles.muted}>
                {t(
                  rule.enforcement === 'block'
                    ? 'rules.enforcement.blockDesc'
                    : 'rules.enforcement.remindDesc',
                )}
              </span>
            </Flexbox>
            {rule.enforcement === 'block' && rule.reasonKind === 'taste' && (
              <Text fontSize={12} style={{ display: 'block', marginTop: 4 }} type={'warning'}>
                {t('rules.enforcement.tasteWarning')}
              </Text>
            )}
          </dd>
          <dt>{t('rules.meta.method')}</dt>
          <dd>
            <Segmented<RuleItem['compilability']>
              disabled={archived || busy}
              size={'small'}
              value={rule.compilability}
              options={(['compiled', 'compilable', 'not-compilable'] as const).map((value) => ({
                label: t(`rules.method.${value}`),
                value,
              }))}
              onChange={(compilability) => void save({ compilability })}
            />
          </dd>
          <dt>{t('rules.meta.reason')}</dt>
          <dd>
            <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
              <Segmented<ExpertiseReasonKind>
                disabled={archived || busy}
                size={'small'}
                value={rule.reasonKind ?? 'taste'}
                options={[
                  { label: t('rules.reason.mechanism'), value: 'mechanism' },
                  { label: t('rules.reason.taste'), value: 'taste' },
                ]}
                onChange={(reasonKind) => void save({ reasonKind })}
              />
              <span className={styles.muted}>
                {t(
                  rule.reasonSource === 'inferred'
                    ? 'rules.reason.inferred'
                    : 'rules.reason.reviewer',
                )}
              </span>
            </Flexbox>
          </dd>
          <dt>{t('rules.meta.scope')}</dt>
          <dd>{group ? scopeLabel(group.scopes) : ''}</dd>
          <dt>{t('rules.meta.runs')}</dt>
          <dd>
            {rule.hitRunCount
              ? t('rules.runs.detail', { hits: rule.hitCount, runs: rule.hitRunCount })
              : t('rules.runs.none')}
            {rule.falsePositiveCount > 0 && (
              <span className={styles.muted}>
                {' '}
                {t('rules.runs.overruled', { count: rule.falsePositiveCount })}
              </span>
            )}
          </dd>
          <dt>{t('rules.meta.origin')}</dt>
          <dd>
            {authored
              ? t('rules.origin.authored')
              : t('rules.origin.distilled', { examples: rule.exampleCount, hits: rule.hitCount }) +
                (rule.lastHitAt
                  ? t('rules.origin.lastHit', { time: dayjs(rule.lastHitAt).fromNow() })
                  : '')}
            {Boolean(rule.generalizedFromIds?.length) && (
              <div className={styles.muted}>
                {t('rules.origin.generalizedFrom', {
                  titles: rule.generalizedFromIds!.map(titleOf).join('」「'),
                })}
              </div>
            )}
            {rule.specificity === 'over-specific' && (
              <div className={styles.muted}>{t('rules.origin.overSpecific')}</div>
            )}
            {rule.specificity === 'one-off' && (
              <div className={styles.muted}>{t('rules.origin.oneOff')}</div>
            )}
            {archived && (
              <div className={styles.muted}>
                {t('rules.archived.at', {
                  time: dayjs(rule.retiredAt ?? undefined).format('YYYY-MM-DD'),
                })}
                {' · '}
                {mergedInto
                  ? t('rules.archived.mergedInto', { title: titleOf(mergedInto) })
                  : t('rules.archived.byYou')}
              </div>
            )}
          </dd>
        </dl>
      </div>

      <div className={styles.body}>
        <Field
          editable={!archived}
          label={t('rules.field.rule')}
          value={rule.title}
          onSave={(title) => title && void save({ title })}
        />
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
          value={limits}
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
            size={'small'}
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
