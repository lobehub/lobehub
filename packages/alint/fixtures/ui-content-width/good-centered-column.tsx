// Fixture: page body centered in a max-width column; the canvas owns its width.
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import ExplorationCanvas from './ExplorationCanvas';
import GoalSummary from './GoalSummary';

const GoalPage = memo<{ goalId: string }>(({ goalId }) => (
  <Flexbox gap={24}>
    <Flexbox gap={12} style={{ marginInline: 'auto', maxWidth: 720, width: '100%' }}>
      <GoalSummary goalId={goalId} />
    </Flexbox>
    <ExplorationCanvas goalId={goalId} />
  </Flexbox>
));

export default GoalPage;
