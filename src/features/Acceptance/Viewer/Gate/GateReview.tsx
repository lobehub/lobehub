'use client';

import type { GoalReleaseGateDossier, GoalReleaseGateUnit } from '@lobechat/types';
import { ActionIcon, Button, Flexbox, Icon, Markdown, Text, TextArea, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  CircleCheck,
  CircleDashed,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  TriangleAlert,
  X,
} from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { GoalDecisionAsker } from '@/features/AgentGoals/GoalDecision';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { mutate as globalMutate } from '@/libs/swr';
import { isAcceptanceListKey } from '@/libs/swr/keys';
import { verifyService } from '@/services/verify';

import { useAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceComments } from '../Comments/hooks';
import { acceptanceOverviewPath } from '../routes';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { canReviewAcceptance, isReadOnlyAcceptanceDecider } from '../visibility';
import { latestRound, unitArtifacts } from './dossier';
import SkillDirectory from './SkillDirectory';
import { usePlanFiles } from './usePlanFiles';

const styles = stylex.create({
  body: {
    fontSize: cssVar.fontSize,
    lineHeight: 1.7,
  },
  // The same action band as the approval island's cards: one tinted strip the
  // decision lives in, apart from the report it decides on.
  footer: {
    paddingBlock: '12px',
    paddingInline: '24px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorder,
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgElevated} 92%, ${cssVar.colorFillSecondary})`,
  },
  footerOnPage: {
    position: 'sticky',
    zIndex: 1,
    insetBlockEnd: 0,
    paddingInline: 0,
    backgroundColor: cssVar.colorBgContainer,
  },
  frame: {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '84vh',
  },
  header: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '12px',
    paddingInline: '24px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorder,
  },
  link: {
    fontSize: cssVar.fontSizeSM,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
  },
  list: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
  },
  meta: {
    fontSize: cssVar.fontSizeSM,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
  },
  panel: {
    overflowX: 'hidden',
    overflowY: 'auto',
    flex: 'none',
    width: '340px',
    paddingBlock: '20px',
    paddingInline: '20px',
    borderInlineStartWidth: '1px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorder,
  },
  plan: {
    paddingBlock: '4px',
    paddingInline: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: cssVar.borderRadiusLG,
  },
  row: {
    cursor: 'pointer',
    paddingBlock: '12px',
    paddingInline: '16px',
    // Rows only ever sit next to other rows in a list (the old `& + &`).
    borderBlockStartWidth: { 'default': null, ':not(:first-child)': '1px' },
    borderBlockStartStyle: { 'default': null, ':not(:first-child)': 'solid' },
    borderBlockStartColor: { 'default': null, ':not(:first-child)': cssVar.colorBorder },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillQuaternary },
  },
  rowActive: {
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillTertiary },
  },
  scroll: {
    overflowY: 'auto',
    flex: '1',
    minWidth: 0,
  },
  section: {
    fontSize: cssVar.fontSizeLG,
    fontWeight: 600,
  },
  title: {
    margin: 0,
    fontSize: cssVar.fontSizeHeading4,
    fontWeight: 600,
    lineHeight: 1.4,
  },
});

/** "A10 返工 #20851 首页 inbox …" → code "A10" and the rest of the title. */
const splitUnitTitle = (title: string) => {
  const [code, ...rest] = title.split(' ');
  return rest.length > 0 && code.length <= 6 ? { code, name: rest.join(' ') } : { name: title };
};

/** Token counts read as 50.4M / 1.2B in every language — the unit models are quoted in. */
const formatTokens = (tokens: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, notation: 'compact' }).format(tokens);

/** A unit the owner has to look at: it was reworked, or did not settle cleanly. */
const isException = (unit: GoalReleaseGateUnit) => unit.runs > 1 || unit.status !== 'resolved';

/** What the side panel shows: a unit that ran, or one the next wave would start. */
type Selection =
  { kind: 'result'; unit: GoalReleaseGateUnit } | { brief?: string; kind: 'next'; title: string };

const UnitTitle = ({ title }: { title: string }) => {
  const { code, name } = splitUnitTitle(title);
  return (
    <span
      style={{
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {code && <b style={{ fontWeight: 600, marginInlineEnd: 8 }}>{code}</b>}
      {name}
    </span>
  );
};

const Section = ({
  children,
  extra,
  title,
  titleExtra,
}: {
  children: ReactNode;
  extra?: ReactNode;
  title: string;
  /** A control that belongs to the title itself, set right after it. */
  titleExtra?: ReactNode;
}) => (
  <Flexbox gap={12}>
    <Flexbox horizontal align={'center'} justify={'space-between'}>
      <Flexbox horizontal align={'center'} gap={4}>
        <span {...stylex.props(styles.section)}>{title}</span>
        {titleExtra}
      </Flexbox>
      {extra}
    </Flexbox>
    {children}
  </Flexbox>
);

const ResultRow = memo<{
  active: boolean;
  average: number;
  onSelect: () => void;
  unit: GoalReleaseGateUnit;
}>(({ active, average, onSelect, unit }) => {
  const { t } = useTranslation('verify');
  const exception = isException(unit);
  const ratio = average > 0 ? unit.tokens / average : 0;
  return (
    <Flexbox gap={4} {...stylex.props(styles.row, active && styles.rowActive)} onClick={onSelect}>
      <Flexbox horizontal align={'center'} gap={12}>
        <Icon
          color={exception ? cssVar.colorWarning : cssVar.colorSuccess}
          icon={exception ? TriangleAlert : CircleCheck}
          size={16}
        />
        <UnitTitle title={unit.title} />
        <span {...stylex.props(styles.meta)}>
          {[
            unit.acceptance?.checks &&
              t('acceptance.gate.unitAcceptance', {
                passed: unit.acceptance.checks.passed,
                total: unit.acceptance.checks.total,
              }),
            t('acceptance.gate.unitMeta', {
              runs: unit.runs,
              tokens: formatTokens(unit.tokens),
            }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </Flexbox>
      {exception && (
        <Text style={{ paddingInlineStart: 28 }} type={'warning'}>
          {unit.status !== 'resolved'
            ? t('acceptance.gate.unitUnsettled')
            : ratio >= 1.5
              ? t('acceptance.gate.unitReworkedCostly', {
                  ratio: ratio.toFixed(1),
                  rework: unit.runs - 1,
                })
              : t('acceptance.gate.unitReworked', { rework: unit.runs - 1 })}
        </Text>
      )}
    </Flexbox>
  );
});

const NextRow = memo<{ active: boolean; onSelect: () => void; title: string }>(
  ({ active, onSelect, title }) => {
    const { t } = useTranslation('verify');
    return (
      <Flexbox
        horizontal
        align={'center'}
        gap={12}
        {...stylex.props(styles.row, active && styles.rowActive)}
        onClick={onSelect}
      >
        <Icon color={cssVar.colorTextQuaternary} icon={CircleDashed} size={16} />
        <UnitTitle title={title} />
        <span {...stylex.props(styles.meta)}>{t('acceptance.gate.unitWaiting')}</span>
      </Flexbox>
    );
  },
);

const DetailPanel = memo<{ onClose: () => void; selection: Selection }>(
  ({ onClose, selection }) => {
    const { t } = useTranslation('verify');
    const workspaceSlug = useActiveWorkspaceSlug();
    const title = selection.kind === 'result' ? selection.unit.title : selection.title;
    const brief = selection.kind === 'result' ? selection.unit.brief : selection.brief;
    return (
      <Flexbox gap={16} {...stylex.props(styles.panel)}>
        <Flexbox horizontal align={'flex-start'} gap={8}>
          <Text strong style={{ flex: 1, minWidth: 0 }}>
            {title}
          </Text>
          <ActionIcon icon={X} size={'small'} onClick={onClose} />
        </Flexbox>
        {selection.kind === 'result' ? (
          <Flexbox gap={8}>
            <span {...stylex.props(styles.meta)}>
              {t('acceptance.gate.unitMeta', {
                runs: selection.unit.runs,
                tokens: formatTokens(selection.unit.tokens),
              })}
            </span>
            {selection.unit.acceptance && (
              <a
                className={stylex.props(styles.link).className}
                rel="noreferrer"
                target="_blank"
                href={buildWorkspaceAwarePath(
                  acceptanceOverviewPath(selection.unit.acceptance.id),
                  workspaceSlug,
                )}
              >
                {selection.unit.acceptance.checks
                  ? t('acceptance.gate.unitAcceptance', {
                      passed: selection.unit.acceptance.checks.passed,
                      total: selection.unit.acceptance.checks.total,
                    })
                  : t('acceptance.gate.unitAcceptanceOpen')}
              </a>
            )}
            {unitArtifacts(selection.unit).map((artifact) =>
              artifact.url ? (
                <a
                  {...stylex.props(styles.link)}
                  href={artifact.url}
                  key={artifact.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {artifact.title}
                </a>
              ) : (
                <span key={artifact.title} {...stylex.props(styles.meta)}>
                  {artifact.title}
                </span>
              ),
            )}
          </Flexbox>
        ) : (
          <span {...stylex.props(styles.meta)}>{t('acceptance.gate.unitWaitingHint')}</span>
        )}
        {brief && (
          <Flexbox gap={6}>
            <span {...stylex.props(styles.meta)}>{t('acceptance.gate.unitBrief')}</span>
            <Text type={'secondary'} {...stylex.props(styles.body)}>
              {brief.replace(/^\[origin=\w+\]\s*/, '')}
            </Text>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

/** How the owner settled the gate: let the next wave run, or send the plan back. */
export type GateDecisionKind = 'release' | 'revise';

const GateDecision = memo<{
  dossier: GoalReleaseGateDossier;
  inModal?: boolean;
  onDecided?: (decision: GateDecisionKind) => void;
}>(({ dossier, inModal, onDecided }) => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data, mutate } = useAcceptanceBundle(acceptanceId);
  const [revising, setRevising] = useState(false);
  const [correction, setCorrection] = useState('');
  const [pending, setPending] = useState(false);
  const { canApprove } = useAcceptanceComments(acceptanceId);
  const readOnly = isReadOnlyAcceptanceDecider(data, canApprove);
  if (!data || (!canReviewAcceptance(data) && !readOnly)) return null;

  const status = data.acceptance.status;
  if (status === 'accepted' || status === 'rejected')
    return (
      <Flexbox {...stylex.props(styles.footer, !inModal && styles.footerOnPage)}>
        <Text type={'secondary'}>
          {status === 'accepted'
            ? t('acceptance.gate.decidedRelease', { wave: dossier.wave })
            : t('acceptance.gate.decidedRevise')}
        </Text>
      </Flexbox>
    );

  const run = async (decision: GateDecisionKind, action: () => Promise<unknown>) => {
    setPending(true);
    try {
      await action();
      await mutate();
      void globalMutate(isAcceptanceListKey);
      onDecided?.(decision);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('acceptance.actionError'));
    } finally {
      setPending(false);
    }
  };

  // The dossier on screen is the latest round's; a revised plan arriving in
  // the meantime makes the server refuse this decision rather than approve it.
  const roundId = latestRound(data)?.run.id;

  const releaseLabel =
    dossier.kind === 'probes'
      ? t('acceptance.gate.startBatch', { count: dossier.nextWave.length })
      : t('acceptance.gate.releaseWave', { count: dossier.nextWave.length, wave: dossier.wave });

  // A teammate who cannot sign the gate still sees what it asks and who signs it.
  if (readOnly)
    return (
      <Flexbox {...stylex.props(styles.footer, !inModal && styles.footerOnPage)}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Text style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
            {t('acceptance.bar.readOnlyReason')}
          </Text>
          <Button disabled>{t('acceptance.gate.revise')}</Button>
          <Button disabled type={'primary'}>
            {releaseLabel}
          </Button>
        </Flexbox>
      </Flexbox>
    );

  return (
    <Flexbox gap={12} {...stylex.props(styles.footer, !inModal && styles.footerOnPage)}>
      {revising && (
        <TextArea
          autoFocus
          autoSize={{ maxRows: 6, minRows: 3 }}
          placeholder={t('acceptance.gate.revisePlaceholder')}
          value={correction}
          onChange={(event) => setCorrection(event.target.value)}
        />
      )}
      <Flexbox horizontal align={'center'} gap={8}>
        <Text style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
          {revising ? t('acceptance.gate.reviseHint') : t('acceptance.gate.decisionHint')}
        </Text>
        {revising ? (
          <>
            <Button disabled={pending} onClick={() => setRevising(false)}>
              {t('acceptance.gate.cancel')}
            </Button>
            <Button
              danger
              disabled={!correction.trim()}
              loading={pending}
              onClick={() =>
                run('revise', () =>
                  verifyService.rejectDelivery(data.acceptance.id, correction.trim(), {
                    dispatch: false,
                    roundId,
                  }),
                )
              }
            >
              {t('acceptance.gate.reviseSubmit')}
            </Button>
          </>
        ) : (
          <>
            <Button disabled={pending} onClick={() => setRevising(true)}>
              {t('acceptance.gate.revise')}
            </Button>
            <Button
              loading={pending}
              type={'primary'}
              onClick={() =>
                run('release', () =>
                  verifyService.acceptDelivery(data.acceptance.id, undefined, { roundId }),
                )
              }
            >
              {releaseLabel}
            </Button>
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
});

interface GateReviewProps {
  dossier: GoalReleaseGateDossier;
  /** Rendered as the review dialog (with its own frame) rather than on the acceptance page. */
  inModal?: boolean;
  onClose?: () => void;
  onDecided?: (decision: GateDecisionKind) => void;
}

/**
 * A Goal decision gate, reported to the owner the way an approval is: who is
 * asking, the plan the batch will copy, what the experiments delivered, and
 * what starts on approval. Any row opens its detail beside the report.
 */
const GateReview = memo<GateReviewProps>(({ dossier, inModal, onClose, onDecided }) => {
  const { t } = useTranslation('verify');
  const [selected, setSelected] = useState<Selection>();
  const { extraFiles, filesOpen, toggleFiles } = usePlanFiles(dossier.plan.skillId);
  const average =
    dossier.units.reduce((sum, unit) => sum + unit.tokens, 0) / Math.max(1, dossier.units.length);
  const probes = dossier.kind === 'probes';
  const reworked = dossier.units.filter((unit) => unit.runs > 1);
  const units = [...dossier.units].sort((a, b) => Number(isException(b)) - Number(isException(a)));
  const estimate = average * (dossier.nextWave.length + dossier.remainingAfter);
  const selectedKey = selected?.kind === 'result' ? selected.unit.nodeId : selected?.title;

  const report = (
    <Flexbox gap={32} style={{ padding: inModal ? 24 : 0 }}>
      <Flexbox gap={8}>
        <h2 {...stylex.props(styles.title)}>
          {probes
            ? t('acceptance.gate.titleProbes')
            : t('acceptance.gate.titleWave', { wave: dossier.wave })}
        </h2>
        <Text type={'secondary'} {...stylex.props(styles.body)}>
          {probes
            ? t('acceptance.gate.leadProbes', {
                count: dossier.units.length,
                remaining: dossier.nextWave.length + dossier.remainingAfter,
              })
            : dossier.kind === 'escalated'
              ? t('acceptance.gate.lead.escalated', { wave: dossier.wave - 1 })
              : t('acceptance.gate.lead.unattended', { wave: dossier.wave - 1 })}
          {reworked.length > 0 &&
            ` ${t('acceptance.gate.leadRework', {
              codes: reworked
                .map((unit) => splitUnitTitle(unit.title).code ?? unit.title)
                .join('、'),
            })}`}
        </Text>
        {dossier.diagnosis && (
          <Text {...stylex.props(styles.body)}>
            {t('acceptance.gate.agentSays', { reason: dossier.diagnosis })}
          </Text>
        )}
      </Flexbox>

      <Section
        title={t('acceptance.gate.planTitle')}
        extra={
          dossier.plan.skillName && (
            <span {...stylex.props(styles.meta)}>
              {dossier.plan.skillName} · v{dossier.plan.revision}
              {extraFiles > 0 && ` · ${t('acceptance.gate.planFiles', { count: extraFiles + 1 })}`}
            </span>
          )
        }
        titleExtra={
          dossier.plan.skillId && (
            <ActionIcon
              icon={filesOpen ? PanelLeftCloseIcon : PanelLeftOpenIcon}
              size={'small'}
              title={t(filesOpen ? 'acceptance.gate.hideFiles' : 'acceptance.gate.showFiles')}
              onClick={toggleFiles}
            />
          )
        }
      >
        {dossier.plan.skillId ? (
          <SkillDirectory
            fallbackContent={dossier.plan.content}
            filesOpen={filesOpen}
            revision={dossier.plan.revision}
            skillId={dossier.plan.skillId}
          />
        ) : (
          <div {...stylex.props(styles.plan)}>
            <Markdown fontSize={14} variant={'chat'}>
              {dossier.plan.content}
            </Markdown>
          </div>
        )}
      </Section>

      <Section
        title={probes ? t('acceptance.gate.resultsProbes') : t('acceptance.gate.resultsWave')}
        extra={
          <span {...stylex.props(styles.meta)}>
            {t('acceptance.gate.unitCount', { count: dossier.units.length })}
          </span>
        }
      >
        <div {...stylex.props(styles.list)}>
          {units.map((unit) => (
            <ResultRow
              active={selectedKey === unit.nodeId}
              average={average}
              key={unit.nodeId}
              unit={unit}
              onSelect={() => setSelected({ kind: 'result', unit })}
            />
          ))}
        </div>
      </Section>

      <Section
        title={t('acceptance.gate.nextWaveTitle', { wave: dossier.wave })}
        extra={
          <span {...stylex.props(styles.meta)}>
            {t('acceptance.gate.unitCount', { count: dossier.nextWave.length })}
          </span>
        }
      >
        <div {...stylex.props(styles.list)}>
          {dossier.nextWave.map((unit) => (
            <NextRow
              active={selectedKey === unit.title}
              key={unit.title}
              title={unit.title}
              onSelect={() => setSelected({ brief: unit.brief, kind: 'next', title: unit.title })}
            />
          ))}
        </div>
        <span {...stylex.props(styles.meta)}>
          {t('acceptance.gate.remaining', {
            count: dossier.remainingAfter,
            estimate: formatTokens(estimate),
          })}
        </span>
      </Section>

      <span {...stylex.props(styles.meta)}>
        {t('acceptance.gate.checks', {
          passed: dossier.checks.filter((check) => check.passed).length,
          total: dossier.checks.length,
        })}
      </span>
    </Flexbox>
  );

  const panel = selected && (
    <DetailPanel selection={selected} onClose={() => setSelected(undefined)} />
  );

  if (!inModal)
    return (
      <Flexbox gap={24}>
        <Flexbox horizontal gap={24}>
          <Flexbox flex={1} style={{ minWidth: 0 }}>
            {report}
          </Flexbox>
          {panel}
        </Flexbox>
        <GateDecision dossier={dossier} onDecided={onDecided} />
      </Flexbox>
    );

  return (
    <div {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.header)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <GoalDecisionAsker
            agentId={dossier.agentId}
            category={'judgment'}
            subtitle={t('acceptance.gate.asker', { goal: dossier.goalTitle })}
          />
        </div>
        {onClose && <ActionIcon icon={X} size={'small'} onClick={onClose} />}
      </div>
      <Flexbox horizontal style={{ flex: 1, minHeight: 0 }}>
        <div {...stylex.props(styles.scroll)}>{report}</div>
        {panel}
      </Flexbox>
      <GateDecision inModal dossier={dossier} onDecided={onDecided} />
    </div>
  );
});

GateReview.displayName = 'AcceptanceGateReview';

export default GateReview;
