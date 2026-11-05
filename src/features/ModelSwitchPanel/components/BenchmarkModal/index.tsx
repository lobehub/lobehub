import { createModal, DropdownMenu, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t } from 'i18next';
import { ChevronDownIcon, ChevronUpIcon, InfoIcon, PlusIcon, XIcon } from 'lucide-react';
import type { ModelRating } from 'model-bank';
import type { FC } from 'react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessModelRating } from '@/business/client/hooks/useBusinessModelRating';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { sx } from '@/styles/sx';

import type { RatingDimensionKey } from '../ModelRatingRadar';
import { RATING_DIMENSION_ORDER, RATING_SOURCE_NAMES } from '../ModelRatingRadar';
import type { CompareRadarSeries } from './CompareRadar';
import CompareRadar, { COMPARE_SERIES_COLORS, MAX_COMPARE_MODELS } from './CompareRadar';

const RULE_KEYS = ['relative', 'sources', 'speed', 'price', 'missing'] as const;

const styles = stylex.create({
  addButton: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: { 'default': cssVar.colorBorder, ':hover': cssVar.colorPrimary },
    borderRadius: '16px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorPrimary },
  },
  addButtonDisabled: {
    cursor: 'not-allowed',
    borderColor: { 'default': cssVar.colorBorder, ':hover': cssVar.colorBorder },
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorTextSecondary },
  },
  bestPill: {
    display: 'inline-block',
    paddingBlock: '1px',
    paddingInline: '8px',
    borderRadius: '10px',
    fontWeight: 600,
  },
  cell: {
    fontSize: '12px',
    color: cssVar.colorText,
    textAlign: 'center',
  },
  cellMissing: {
    color: cssVar.colorTextQuaternary,
  },
  chip: {
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    maxWidth: '200px',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    fontSize: '12px',
    color: cssVar.colorText,
  },
  chipName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  chipRemove: {
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
  },
  colorDot: {
    flexShrink: 0,
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  headerCell: {
    overflow: 'hidden',
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
  headerName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  ruleItem: {
    fontSize: '12px',
    lineHeight: 1.6,
    color: cssVar.colorTextTertiary,
  },
  rulesList: {
    margin: 0,
    paddingInlineStart: '16px',
  },
  rulesToggle: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    alignSelf: 'flex-start',
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorTextSecondary },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  sourceLink: {
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorPrimary },
  },
  table: {
    display: 'grid',
    rowGap: '4px',
  },
  tableDivider: {
    gridColumnStart: '1',
    gridColumnEnd: '-1',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  tableHeader: {
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
  },
  tableRowLabel: {
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textAlign: 'start',
  },
});

interface RatedModel {
  displayName: string;
  id: string;
  rating: ModelRating;
}

interface SelectedSeries extends RatedModel {
  color: string;
}

const dimensionLabel = (key: RatingDimensionKey) =>
  String(t(`ModelSwitchPanel.detail.rating.dimension.${key}`, { ns: 'components' }));

interface ScoreCellProps {
  best: boolean;
  /** the model's series color — the best-in-row pill is tinted with it */
  color: string;
  score: NonNullable<ModelRating[RatingDimensionKey]> | undefined;
}

const ScoreCell: FC<ScoreCellProps> = ({ best, color, score }) => {
  if (!score)
    return (
      <span data-testid={'cell-missing'} {...stylex.props(styles.cell, styles.cellMissing)}>
        -
      </span>
    );

  const tooltip = [
    RATING_SOURCE_NAMES[score.source],
    score.raw === undefined ? undefined : String(score.raw),
    score.updatedAt,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Tooltip title={tooltip}>
      <span {...stylex.props(styles.cell)}>
        {best ? (
          // series color + '26' alpha suffix ≈ 15% tint background
          <span
            data-testid={'best-pill'}
            {...sx([styles.bestPill], undefined, { background: `${color}26`, color })}
          >
            {score.score}
          </span>
        ) : (
          score.score
        )}
      </span>
    </Tooltip>
  );
};

interface BenchmarkModalContentProps {
  modelId: string;
  provider: string;
}

const BenchmarkModalContent: FC<BenchmarkModalContentProps> = memo(({ modelId, provider }) => {
  const { t } = useTranslation('components');
  const enabledList = useEnabledChatModels();
  const applyRating = useBusinessModelRating();
  const [selectedIds, setSelectedIds] = useState<string[]>([modelId]);
  // rules are low-frequency reference content — collapsed by default so the
  // radar and score table keep the modal's vertical space
  const [rulesOpen, setRulesOpen] = useState(false);

  // all rated models of the same provider — the compare candidate pool
  const ratedModels = useMemo<RatedModel[]>(() => {
    const providerData = enabledList.find((item) => item.id === provider);

    return (providerData?.children ?? []).flatMap((model) => {
      const rating = applyRating({ model: model.id, provider });
      if (!rating || Object.keys(rating).length === 0) return [];

      return [{ displayName: model.displayName || model.id, id: model.id, rating }];
    });
  }, [applyRating, enabledList, provider]);

  const selected = useMemo<SelectedSeries[]>(
    () =>
      selectedIds.flatMap((id, index) => {
        const model = ratedModels.find((item) => item.id === id);

        return model ? [{ ...model, color: COMPARE_SERIES_COLORS[index] }] : [];
      }),
    [ratedModels, selectedIds],
  );

  const candidates = useMemo(
    () => ratedModels.filter((model) => !selectedIds.includes(model.id)),
    [ratedModels, selectedIds],
  );

  const dimensions = RATING_DIMENSION_ORDER.map((key) => ({ key, label: dimensionLabel(key) }));

  const series: CompareRadarSeries[] = selected.map((model) => ({
    color: model.color,
    id: model.id,
    name: model.displayName,
    scores: RATING_DIMENSION_ORDER.map((key) => model.rating[key]?.score),
  }));

  const isCompare = selected.length > 1;
  const atLimit = selectedIds.length >= MAX_COMPARE_MODELS;
  const canAdd = candidates.length > 0 && !atLimit;

  const addButton = (
    <button
      {...stylex.props(styles.addButton, !canAdd && styles.addButtonDisabled)}
      disabled={!canAdd}
      type={'button'}
    >
      <Icon icon={PlusIcon} size={12} />
      {t('ModelSwitchPanel.detail.rating.modal.compare.add')}
    </button>
  );

  return (
    <Flexbox gap={16} paddingBlock={'0 8px'}>
      {/* selected model chips + compare picker */}
      <Flexbox horizontal align={'center'} gap={8} style={{ flexWrap: 'wrap' }}>
        {selected.map((model) => (
          <span {...stylex.props(styles.chip)} key={model.id}>
            <span {...sx([styles.colorDot], undefined, { background: model.color })} />
            <span {...stylex.props(styles.chipName)}>{model.displayName}</span>
            {selected.length > 1 && (
              <span
                data-testid={'chip-remove'}
                {...stylex.props(styles.chipRemove)}
                role={'button'}
                onClick={() => setSelectedIds((prev) => prev.filter((id) => id !== model.id))}
              >
                <Icon icon={XIcon} size={12} />
              </span>
            )}
          </span>
        ))}
        {candidates.length > 0 &&
          (canAdd ? (
            <DropdownMenu
              items={candidates.map((model) => ({
                key: model.id,
                label: model.displayName,
                onClick: () => setSelectedIds((prev) => [...prev, model.id]),
              }))}
            >
              {addButton}
            </DropdownMenu>
          ) : (
            <Tooltip
              title={t('ModelSwitchPanel.detail.rating.modal.compare.limit', {
                count: MAX_COMPARE_MODELS,
              })}
            >
              {addButton}
            </Tooltip>
          ))}
      </Flexbox>

      <CompareRadar dimensions={dimensions} series={series} />

      {/* score details: single model = source breakdown, compare = score matrix */}
      {isCompare ? (
        <div
          {...sx([styles.table], undefined, {
            gridTemplateColumns: `88px repeat(${selected.length}, 1fr)`,
          })}
        >
          <span {...stylex.props(styles.tableHeader, styles.tableRowLabel)}>
            {t('ModelSwitchPanel.detail.rating.modal.table.dimension')}
          </span>
          {selected.map((model) => (
            <span {...stylex.props(styles.headerCell)} key={model.id}>
              <span {...sx([styles.colorDot], undefined, { background: model.color })} />
              <span {...stylex.props(styles.headerName)}>{model.displayName}</span>
            </span>
          ))}
          <div {...stylex.props(styles.tableDivider)} />
          {RATING_DIMENSION_ORDER.flatMap((key, dimensionIndex) => {
            const scores = selected.map((model) => model.rating[key]?.score);
            const bestScore = Math.max(...scores.map((score) => score ?? -1));

            return [
              <span {...stylex.props(styles.tableRowLabel)} key={`${key}-label`}>
                {dimensions[dimensionIndex].label}
              </span>,
              ...selected.map((model) => (
                <ScoreCell
                  best={model.rating[key]?.score === bestScore && bestScore >= 0}
                  color={model.color}
                  key={`${key}-${model.id}`}
                  score={model.rating[key]}
                />
              )),
            ];
          })}
        </div>
      ) : (
        selected[0] && (
          <div
            {...sx([styles.table], undefined, { gridTemplateColumns: '88px 1fr 1fr 1.4fr 1fr' })}
          >
            {(['dimension', 'score', 'raw', 'source', 'updatedAt'] as const).map((column) => (
              <span
                key={column}
                {...stylex.props(
                  styles.tableHeader,
                  column === 'dimension' && styles.tableRowLabel,
                )}
              >
                {t(`ModelSwitchPanel.detail.rating.modal.table.${column}`)}
              </span>
            ))}
            <div {...stylex.props(styles.tableDivider)} />
            {RATING_DIMENSION_ORDER.flatMap((key, dimensionIndex) => {
              const score = selected[0].rating[key];

              if (!score)
                return [
                  <span
                    data-testid={'cell-missing'}
                    {...stylex.props(styles.tableRowLabel, styles.cellMissing)}
                    key={`${key}-label`}
                  >
                    {dimensions[dimensionIndex].label}
                  </span>,
                  ...Array.from({ length: 4 }, (_, i) => (
                    <span
                      data-testid={'cell-missing'}
                      {...stylex.props(styles.cell, styles.cellMissing)}
                      key={`${key}-${i}`}
                    >
                      -
                    </span>
                  )),
                ];

              return [
                <span {...stylex.props(styles.tableRowLabel)} key={`${key}-label`}>
                  {dimensions[dimensionIndex].label}
                </span>,
                <span {...sx([styles.cell], undefined, { fontWeight: 600 })} key={`${key}-score`}>
                  {score.score}
                </span>,
                <span {...stylex.props(styles.cell)} key={`${key}-raw`}>
                  {score.raw ?? '-'}
                </span>,
                <span {...stylex.props(styles.cell)} key={`${key}-source`}>
                  <a
                    {...stylex.props(styles.sourceLink)}
                    href={score.sourceUrl}
                    rel={'noreferrer'}
                    target={'_blank'}
                  >
                    {RATING_SOURCE_NAMES[score.source]}
                  </a>
                </span>,
                <span {...stylex.props(styles.cell)} key={`${key}-updated`}>
                  {score.updatedAt}
                </span>,
              ];
            })}
          </div>
        )
      )}

      {/* scoring rules & caveats — collapsed footer entry */}
      <Flexbox gap={8}>
        <button
          {...stylex.props(styles.rulesToggle)}
          type={'button'}
          onClick={() => setRulesOpen((prev) => !prev)}
        >
          <Icon icon={InfoIcon} size={12} />
          {t('ModelSwitchPanel.detail.rating.modal.rules.title')}
          <Icon icon={rulesOpen ? ChevronUpIcon : ChevronDownIcon} size={12} />
        </button>
        {rulesOpen && (
          <ul {...stylex.props(styles.rulesList)}>
            {RULE_KEYS.map((key) => (
              <li {...stylex.props(styles.ruleItem)} key={key}>
                {t(`ModelSwitchPanel.detail.rating.modal.rules.${key}`)}
              </li>
            ))}
          </ul>
        )}
      </Flexbox>
    </Flexbox>
  );
});

BenchmarkModalContent.displayName = 'BenchmarkModalContent';

export const openBenchmarkModal = (props: BenchmarkModalContentProps) =>
  createModal({
    content: <BenchmarkModalContent {...props} />,
    footer: null,
    maskClosable: true,
    title: t('ModelSwitchPanel.detail.rating.modal.title', { ns: 'components' }),
    width: 560,
  });

export default BenchmarkModalContent;
