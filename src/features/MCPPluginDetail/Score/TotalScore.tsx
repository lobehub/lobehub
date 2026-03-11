import { Block, Center, Flexbox, Popover } from '@lobehub/ui';
import { Progress } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type ScoreResult } from '../../MCP/calculateScore';
import { sortItemsByPriority } from '../../MCP/calculateScore';

// 使用 cssVar 的 getGradeColor 版本
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

const styles = createStaticStyles(({ css }) => ({
  colorDot: css`
    width: 8px;
    height: 8px;
    border-radius: 50%;
  `,
  container: css`
    padding: 24px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    background: ${cssVar.colorFillQuaternary};
  `,
  description: css`
    margin-block-start: 8px;
    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
  `,
  gradeBadge: css`
    flex: none;

    width: 32px;
    height: 32px;
    border: 2px solid;
    border-radius: 50%;

    font-size: 16px;
    font-weight: bold;
  `,
  gradeInfo: css`
    display: flex;
    gap: 12px;
    align-items: center;
    margin-block-start: 12px;
  `,
  itemList: css`
    margin-block: 8px;
    margin-inline: 0;
    padding-inline-start: 16px;

    li {
      margin-block: 4px;
      margin-inline: 0;
    }
  `,
  legend: css`
    display: flex;
    gap: 16px;
    margin-block-start: 8px;
    font-size: 12px;
  `,
  legendItem: css`
    display: flex;
    gap: 4px;
    align-items: center;
  `,
  progressContainer: css`
    margin-block-start: 16px;
  `,
  scoreText: css`
    font-size: 24px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  sectionTitle: css`
    margin-block: 12px 6px;
    margin-inline: 0;
    padding-block-start: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};

    &:first-of-type {
      padding-block-start: 0;
      border-block-start: none;
    }
  `,
  tooltipContent: css`
    max-width: 400px;
    line-height: 1.5;
  `,
}));

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

  // 使用主题颜色的段级颜色配置
  const SEGMENT_COLORS = {
    // 绿色 (80-100%)
    A_COLOR: cssVar.colorSuccess,

    // 黄色 (60-85%)
    B_COLOR: cssVar.colorWarning,

    // 红色 (0-60%)
    F_COLOR: cssVar.colorError,
  };

  const allItems = sortItemsByPriority([...scoreItems]);
  const completedRequired = allItems.filter((item) => item.required && item.check);
  const incompleteRequired = allItems.filter((item) => item.required && !item.check);
  const completedOptional = allItems.filter((item) => !item.required && item.check);
  const incompleteOptional = allItems.filter((item) => !item.required && !item.check);

  // 计算必需项个数
  const totalRequiredItems = completedRequired.length + incompleteRequired.length;
  const completedRequiredItems = completedRequired.length;

  // 生成 tooltip 内容
  const renderTooltipContent = () => (
    <div className={styles.tooltipContent}>
      <div style={{ fontSize: '14px', marginBottom: '12px' }}>
        <strong>
          {totalScore}/{maxScore} {t('mcp.details.totalScore.scoreInfo.points')} (
          {Math.round(percentage)}%)
        </strong>
      </div>

      {completedRequired.length > 0 && (
        <>
          <div className={styles.sectionTitle} style={{ color: getGradeColor(grade) }}>
            {t('mcp.details.totalScore.popover.completedRequired', {
              count: completedRequired.length,
            })}
            :
          </div>
          <ul className={styles.itemList}>
            {completedRequired.map((item, index) => (
              <li key={index}>{item.title}</li>
            ))}
          </ul>
        </>
      )}

      {incompleteRequired.length > 0 && (
        <>
          <div className={styles.sectionTitle} style={{ color: cssVar.colorError }}>
            {t('mcp.details.totalScore.popover.incompleteRequired', {
              count: incompleteRequired.length,
            })}
            :
          </div>
          <ul className={styles.itemList}>
            {incompleteRequired.map((item, index) => (
              <li key={index}>{item.title}</li>
            ))}
          </ul>
        </>
      )}

      {completedOptional.length > 0 && (
        <>
          <div className={styles.sectionTitle} style={{ color: getGradeColor(grade) }}>
            {t('mcp.details.totalScore.popover.completedOptional', {
              count: completedOptional.length,
            })}
            :
          </div>
          <ul className={styles.itemList}>
            {completedOptional.map((item, index) => (
              <li key={index}>{item.title}</li>
            ))}
          </ul>
        </>
      )}

      {incompleteOptional.length > 0 && (
        <>
          <div className={styles.sectionTitle} style={{ color: cssVar.colorTextSecondary }}>
            {t('mcp.details.totalScore.popover.incompleteOptional', {
              count: incompleteOptional.length,
            })}
            :
          </div>
          <ul className={styles.itemList}>
            {incompleteOptional.map((item, index) => (
              <li key={index}>{item.title}</li>
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
          <div className={styles.description}>{t(`mcp.details.scoreLevel.${grade}.desc`)}</div>
        </Flexbox>
        {isValidated && (
          <Center
            className={styles.gradeBadge}
            style={{
              borderColor: getGradeColor(grade),
              color: getGradeColor(grade),
            }}
          >
            {grade.toUpperCase()}
          </Center>
        )}
      </Flexbox>

      <div className={styles.progressContainer}>
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
            size={{
              height: 8,
            }}
            strokeColor={{
              '0%': SEGMENT_COLORS.F_COLOR,
              '60%': SEGMENT_COLORS.B_COLOR,
              '80%': SEGMENT_COLORS.A_COLOR,
            }}
          />
        </Popover>

        <div className={styles.legend}>
          <div className={styles.legendItem}>
            <div className={styles.colorDot} style={{ backgroundColor: SEGMENT_COLORS.F_COLOR }} />
            <span>{t('mcp.details.totalScore.legend.fGrade', { maxPercent: 60 })}</span>
          </div>
          <div className={styles.legendItem}>
            <div className={styles.colorDot} style={{ backgroundColor: SEGMENT_COLORS.B_COLOR }} />
            <span>
              {t('mcp.details.totalScore.legend.bGrade', { maxPercent: 80, minPercent: 60 })}
            </span>
          </div>
          <div className={styles.legendItem}>
            <div className={styles.colorDot} style={{ backgroundColor: SEGMENT_COLORS.A_COLOR }} />
            <span>{t('mcp.details.totalScore.legend.aGrade', { minPercent: 80 })}</span>
          </div>
        </div>
      </div>

      <div className={styles.gradeInfo}>
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
