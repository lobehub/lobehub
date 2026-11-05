import { Block, Center, Flexbox, Popover, Progress } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { type ScoreResult } from '../../MCP/calculateScore';
import { sortItemsByPriority } from '../../MCP/calculateScore';

// Version of getGradeColor using cssVar
const getGradeColor = (grade: string): string => {
  switch (grade) {
    case 'a': {
      return cssVar.colorSuccess;
    }
    case 'b': {
      return cssVar.colorWarning;
    }
    case 'f': {
      return cssVar.colorError;
    }
    default: {
      return cssVar.colorTextSecondary;
    }
  }
};

const styles = stylex.create({
  colorDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  description: {
    marginBlockStart: '8px',
    fontSize: '14px',
    color: cssVar.colorTextSecondary,
  },
  gradeBadge: {
    flex: 'none',
    width: '32px',
    height: '32px',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderRadius: '50%',
    fontSize: '16px',
    fontWeight: 'bold',
  },
  gradeInfo: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    marginBlockStart: '12px',
  },
  itemList: {
    marginBlock: '8px',
    marginInline: 0,
    paddingInlineStart: '16px',
  },
  itemListItem: {
    marginBlock: '4px',
    marginInline: 0,
  },
  legend: {
    display: 'flex',
    gap: '16px',
    marginBlockStart: '8px',
    fontSize: '12px',
  },
  legendItem: {
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
  },
  progressContainer: {
    marginBlockStart: '16px',
  },
  sectionTitle: {
    marginBlockStart: '12px',
    marginBlockEnd: '6px',
    marginInline: 0,
    paddingBlockStart: { 'default': '8px', ':first-of-type': 0 },
    borderBlockStartWidth: { 'default': '1px', ':first-of-type': null },
    borderBlockStartStyle: { 'default': 'solid', ':first-of-type': 'none' },
    borderBlockStartColor: cssVar.colorBorderSecondary,
    fontSize: '14px',
    fontWeight: 600,
    color: cssVar.colorText,
  },
  tooltipContent: {
    maxWidth: '400px',
    lineHeight: 1.5,
  },
});

interface ScoreItem {
  check: boolean;
  required?: boolean;
  title: string;
  weight?: number;
}

interface TotalScoreProps {
  isValidated?: boolean;
  scoreItems?: ScoreItem[];
  scoreResult: ScoreResult;
}

const TotalScore = memo<TotalScoreProps>(({ scoreResult, scoreItems = [], isValidated }) => {
  const { t } = useTranslation('discover');

  const { totalScore, maxScore, percentage, grade } = scoreResult;

  // Segment-level color configuration using theme colors
  const SEGMENT_COLORS = {
    // Green (80-100%)
    A_COLOR: cssVar.colorSuccess,

    // Yellow (60-85%)
    B_COLOR: cssVar.colorWarning,

    // Red (0-60%)
    F_COLOR: cssVar.colorError,
  };

  const allItems = sortItemsByPriority([...scoreItems]);
  const completedRequired = allItems.filter((item) => item.required && item.check);
  const incompleteRequired = allItems.filter((item) => item.required && !item.check);
  const completedOptional = allItems.filter((item) => !item.required && item.check);
  const incompleteOptional = allItems.filter((item) => !item.required && !item.check);

  // Count the number of required items
  const totalRequiredItems = completedRequired.length + incompleteRequired.length;
  const completedRequiredItems = completedRequired.length;

  // Generate tooltip content
  const renderTooltipContent = () => (
    <div {...stylex.props(styles.tooltipContent)}>
      <div style={{ fontSize: '14px', marginBottom: '12px' }}>
        <strong>
          {totalScore}/{maxScore} {t('mcp.details.totalScore.scoreInfo.points')} (
          {Math.round(percentage)}%)
        </strong>
      </div>

      {completedRequired.length > 0 && (
        <>
          <div {...sx([styles.sectionTitle], undefined, { color: getGradeColor(grade) })}>
            {t('mcp.details.totalScore.popover.completedRequired', {
              count: completedRequired.length,
            })}
            :
          </div>
          <ul {...stylex.props(styles.itemList)}>
            {completedRequired.map((item, index) => (
              <li key={index} {...stylex.props(styles.itemListItem)}>
                {item.title}
              </li>
            ))}
          </ul>
        </>
      )}

      {incompleteRequired.length > 0 && (
        <>
          <div {...sx([styles.sectionTitle], undefined, { color: cssVar.colorError })}>
            {t('mcp.details.totalScore.popover.incompleteRequired', {
              count: incompleteRequired.length,
            })}
            :
          </div>
          <ul {...stylex.props(styles.itemList)}>
            {incompleteRequired.map((item, index) => (
              <li key={index} {...stylex.props(styles.itemListItem)}>
                {item.title}
              </li>
            ))}
          </ul>
        </>
      )}

      {completedOptional.length > 0 && (
        <>
          <div {...sx([styles.sectionTitle], undefined, { color: getGradeColor(grade) })}>
            {t('mcp.details.totalScore.popover.completedOptional', {
              count: completedOptional.length,
            })}
            :
          </div>
          <ul {...stylex.props(styles.itemList)}>
            {completedOptional.map((item, index) => (
              <li key={index} {...stylex.props(styles.itemListItem)}>
                {item.title}
              </li>
            ))}
          </ul>
        </>
      )}

      {incompleteOptional.length > 0 && (
        <>
          <div {...sx([styles.sectionTitle], undefined, { color: cssVar.colorTextSecondary })}>
            {t('mcp.details.totalScore.popover.incompleteOptional', {
              count: incompleteOptional.length,
            })}
            :
          </div>
          <ul {...stylex.props(styles.itemList)}>
            {incompleteOptional.map((item, index) => (
              <li key={index} {...stylex.props(styles.itemListItem)}>
                {item.title}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  return (
    <Block gap={12} padding={16} variant={'outlined'}>
      <Flexbox horizontal align="flex-start" justify="space-between">
        <Flexbox>
          <h2 style={{ fontWeight: 'bold', margin: 0 }}>
            {t(`mcp.details.scoreLevel.${grade}.fullTitle`)}
          </h2>
          <div {...stylex.props(styles.description)}>
            {t(`mcp.details.scoreLevel.${grade}.desc`)}
          </div>
        </Flexbox>
        {isValidated && (
          <Center
            className={stylex.props(styles.gradeBadge).className}
            style={{
              borderColor: getGradeColor(grade),
              color: getGradeColor(grade),
            }}
          >
            {grade.toUpperCase()}
          </Center>
        )}
      </Flexbox>

      <div {...stylex.props(styles.progressContainer)}>
        <Popover
          placement="bottom"
          trigger={['hover', 'click']}
          content={
            <div>
              <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
                {t('mcp.details.totalScore.popover.title')}
              </div>
              {renderTooltipContent()}
            </div>
          }
        >
          <Progress
            percent={Math.round(percentage)}
            showInfo={false}
            size={8}
            strokeColor={getGradeColor(grade)}
          />
        </Popover>

        <div {...stylex.props(styles.legend)}>
          <div {...stylex.props(styles.legendItem)}>
            <div
              {...sx([styles.colorDot], undefined, { backgroundColor: SEGMENT_COLORS.F_COLOR })}
            />
            <span>{t('mcp.details.totalScore.legend.fGrade', { maxPercent: 60 })}</span>
          </div>
          <div {...stylex.props(styles.legendItem)}>
            <div
              {...sx([styles.colorDot], undefined, { backgroundColor: SEGMENT_COLORS.B_COLOR })}
            />
            <span>
              {t('mcp.details.totalScore.legend.bGrade', { maxPercent: 80, minPercent: 60 })}
            </span>
          </div>
          <div {...stylex.props(styles.legendItem)}>
            <div
              {...sx([styles.colorDot], undefined, { backgroundColor: SEGMENT_COLORS.A_COLOR })}
            />
            <span>{t('mcp.details.totalScore.legend.aGrade', { minPercent: 80 })}</span>
          </div>
        </div>
      </div>

      <div {...stylex.props(styles.gradeInfo)}>
        <span style={{ fontSize: '16px', fontWeight: 600 }}>
          {totalScore}/{maxScore} {t('mcp.details.totalScore.scoreInfo.points')}
        </span>
        <span style={{ color: getGradeColor(grade), fontWeight: 600 }}>
          {Math.round(percentage)}%
        </span>
        <span style={{ color: getGradeColor(grade), fontSize: '14px' }}>
          {t('mcp.details.totalScore.scoreInfo.requiredItems')}: {completedRequiredItems}/
          {totalRequiredItems} {t('mcp.details.totalScore.scoreInfo.items')}
        </span>
      </div>
    </Block>
  );
});

export default TotalScore;
