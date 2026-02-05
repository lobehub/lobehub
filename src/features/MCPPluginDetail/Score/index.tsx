import { Block, Flexbox, Grid } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  calculateScore,
  calculateScoreFlags,
  createScoreItems,
  sortItemsByPriority,
} from '@/features/MCP/calculateScore';
import { useScoreList } from '@/features/MCP/useScoreList';

import Title from '../../../app/[variants]/(main)/community/features/Title';
import { useDetailContext } from '../DetailProvider';
import GithubBadge from './GithubBadge';
import ScoreList from './ScoreList';
import TotalScore from './TotalScore';

const Score = memo(() => {
  const { t } = useTranslation('discover');
  const {
    github,
    overview,
    isValidated,
    toolsCount,
    promptsCount,
    resourcesCount,
    deploymentOptions,
  } = useDetailContext();

  // 使用工具函数计算所有的 has* 值
  const scoreFlags = calculateScoreFlags({
    deploymentOptions,
    github,
    isClaimed: false, // 详情页暂时没有 claimed 状态
    isValidated,
    overview,
    promptsCount,
    resourcesCount,
    toolsCount,
  });

  // 计算总分和评级
  const scoreItems = createScoreItems(scoreFlags);
  const scoreResult = calculateScore(scoreItems);

  // 使用新的 hook 创建评分项目列表
  const scoreListItems = useScoreList();

  // 使用工具函数排序
  const sortedScoreListItems = sortItemsByPriority(scoreListItems);

  return (
    <Flexbox gap={16}>
      {/* 总分显示 */}
      <TotalScore
        isValidated={isValidated}
        scoreResult={scoreResult}
        scoreItems={scoreListItems.map((item) => ({
          check: item.check,
          required: item.required,
          title: item.title,
          weight: item.weight,
        }))}
      />

      {/* 评分明细 */}

      <Grid rows={2}>
        <Flexbox gap={16}>
          <Title>{t('mcp.details.score.listTitle')}</Title>
          <Block variant={'outlined'}>
            <ScoreList items={sortedScoreListItems} />
          </Block>
        </Flexbox>
        <Flexbox gap={16}>
          <Title>GitHub Badge</Title>
          <Block gap={16} padding={16} variant={'outlined'}>
            <GithubBadge />
          </Block>
        </Flexbox>
      </Grid>
    </Flexbox>
  );
});

export default Score;
