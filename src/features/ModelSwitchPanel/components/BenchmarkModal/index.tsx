import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { createModal, DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { t } from 'i18next';
import { ChevronDownIcon, ChevronUpIcon, InfoIcon, PlusIcon, XIcon } from 'lucide-react';
import type { ModelRating } from 'model-bank';
import type { FC } from 'react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessModelRating } from '@/business/client/hooks/useBusinessModelRating';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';

import type { RatingDimensionKey } from '../ModelRatingRadar';
import { RATING_DIMENSION_ORDER, RATING_SOURCE_NAMES } from '../ModelRatingRadar';
import type { CompareRadarSeries } from './CompareRadar';
import CompareRadar, { COMPARE_SERIES_COLORS, MAX_COMPARE_MODELS } from './CompareRadar';

const RULE_KEYS = ['relative', 'sources', 'speed', 'price', 'missing'] as const;

const styles = createStaticStyles(({ css, cssVar }) => ({
  addButton: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 8px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: 16px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      border-color: ${cssVar.colorPrimary};
      color: ${cssVar.colorPrimary};
    }
  `,
  addButtonDisabled: css`
    cursor: not-allowed;

    &:hover {
      border-color: ${cssVar.colorBorder};
      color: ${cssVar.colorTextSecondary};
    }
  `,
  bestPill: css`
    display: inline-block;

    padding-block: 1px;
    padding-inline: 8px;
    border-radius: 10px;

    font-weight: 600;
  `,
  cell: css`
    font-size: 12px;
    color: ${cssVar.colorText};
    text-align: center;
  `,
  cellMissing: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  chip: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    max-width: 200px;
    padding-block: 2px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    font-size: 12px;
    color: ${cssVar.colorText};
  `,
  chipName: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  chipRemove: css`
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  colorDot: css`
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  `,
  headerCell: css`
    overflow: hidden;
    display: inline-flex;
    gap: 6px;
    align-items: center;
    justify-content: center;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  headerName: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  ruleItem: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
  `,
  rulesList: css`
    margin: 0;
    padding-inline-start: 16px;
  `,
  rulesToggle: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;
    align-self: flex-start;

    padding: 0;
    border: none;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    background: none;

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  sourceLink: css`
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  table: css`
    display: grid;
    row-gap: 4px;
  `,
  tableDivider: css`
    grid-column: 1 / -1;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  tableHeader: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  tableRowLabel: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-align: start;
  `,
}));

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
  if (!score) return <span className={`${styles.cell} ${styles.cellMissing}`}>-</span>;

  const tooltip = [
    RATING_SOURCE_NAMES[score.source],
    score.raw === undefined ? undefined : String(score.raw),
    score.updatedAt,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Tooltip title={tooltip}>
      <span className={styles.cell}>
        {best ? (
          // series color + '26' alpha suffix ≈ 15% tint background
          <span className={styles.bestPill} style={{ background: `${color}26`, color }}>
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
    scores: RATING_DIMENSION_ORDER.map((key) => model.rating[key]?.score),
  }));

  const isCompare = selected.length > 1;
  const atLimit = selectedIds.length >= MAX_COMPARE_MODELS;
  const canAdd = candidates.length > 0 && !atLimit;

  const addButton = (
    <button
      className={canAdd ? styles.addButton : `${styles.addButton} ${styles.addButtonDisabled}`}
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
          <span className={styles.chip} key={model.id}>
            <span className={styles.colorDot} style={{ background: model.color }} />
            <span className={styles.chipName}>{model.displayName}</span>
            {selected.length > 1 && (
              <span
                className={styles.chipRemove}
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
          className={styles.table}
          style={{ gridTemplateColumns: `88px repeat(${selected.length}, 1fr)` }}
        >
          <span className={`${styles.tableHeader} ${styles.tableRowLabel}`}>
            {t('ModelSwitchPanel.detail.rating.modal.table.dimension')}
          </span>
          {selected.map((model) => (
            <span className={styles.headerCell} key={model.id}>
              <span className={styles.colorDot} style={{ background: model.color }} />
              <span className={styles.headerName}>{model.displayName}</span>
            </span>
          ))}
          <div className={styles.tableDivider} />
          {RATING_DIMENSION_ORDER.flatMap((key, dimensionIndex) => {
            const scores = selected.map((model) => model.rating[key]?.score);
            const bestScore = Math.max(...scores.map((score) => score ?? -1));

            return [
              <span className={styles.tableRowLabel} key={`${key}-label`}>
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
          <div className={styles.table} style={{ gridTemplateColumns: '88px 1fr 1fr 1.4fr 1fr' }}>
            {(['dimension', 'score', 'raw', 'source', 'updatedAt'] as const).map((column) => (
              <span
                key={column}
                className={
                  column === 'dimension'
                    ? `${styles.tableHeader} ${styles.tableRowLabel}`
                    : styles.tableHeader
                }
              >
                {t(`ModelSwitchPanel.detail.rating.modal.table.${column}`)}
              </span>
            ))}
            <div className={styles.tableDivider} />
            {RATING_DIMENSION_ORDER.flatMap((key, dimensionIndex) => {
              const score = selected[0].rating[key];

              if (!score)
                return [
                  <span
                    className={`${styles.tableRowLabel} ${styles.cellMissing}`}
                    key={`${key}-label`}
                  >
                    {dimensions[dimensionIndex].label}
                  </span>,
                  ...Array.from({ length: 4 }, (_, i) => (
                    <span className={`${styles.cell} ${styles.cellMissing}`} key={`${key}-${i}`}>
                      -
                    </span>
                  )),
                ];

              return [
                <span className={styles.tableRowLabel} key={`${key}-label`}>
                  {dimensions[dimensionIndex].label}
                </span>,
                <span className={styles.cell} key={`${key}-score`} style={{ fontWeight: 600 }}>
                  {score.score}
                </span>,
                <span className={styles.cell} key={`${key}-raw`}>
                  {score.raw ?? '-'}
                </span>,
                <span className={styles.cell} key={`${key}-source`}>
                  <a
                    className={styles.sourceLink}
                    href={score.sourceUrl}
                    rel={'noreferrer'}
                    target={'_blank'}
                  >
                    {RATING_SOURCE_NAMES[score.source]}
                  </a>
                </span>,
                <span className={styles.cell} key={`${key}-updated`}>
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
          className={styles.rulesToggle}
          type={'button'}
          onClick={() => setRulesOpen((prev) => !prev)}
        >
          <Icon icon={InfoIcon} size={12} />
          {t('ModelSwitchPanel.detail.rating.modal.rules.title')}
          <Icon icon={rulesOpen ? ChevronUpIcon : ChevronDownIcon} size={12} />
        </button>
        {rulesOpen && (
          <ul className={styles.rulesList}>
            {RULE_KEYS.map((key) => (
              <li className={styles.ruleItem} key={key}>
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
