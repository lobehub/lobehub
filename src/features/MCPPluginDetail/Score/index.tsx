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
import Title from '@/routes/(main)/community/features/Title';

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

  // Use utility function to calculate all has* values
  const scoreFlags = calculateScoreFlags({
    deploymentOptions,
    github,
    isClaimed: false, // Detail page does not have claimed state yet
    isValidated,
    overview,
    promptsCount,
    resourcesCount,
    toolsCount,
  });

  // Calculate total score and grade
  const scoreItems = createScoreItems(scoreFlags);
  const scoreResult = calculateScore(scoreItems);

  // Use the new hook to create the score item list
  const scoreListItems = useScoreList();

  // Sort using utility function
  const sortedScoreListItems = sortItemsByPriority(scoreListItems);

  return (
    <Flexbox gap={16}>
      {/* Total score display */}
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

      {/* Score details */}

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
