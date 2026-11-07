import { Alert, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import type { ReviewView } from '../api';
import { hasScreenshots, reviewGrid } from '../review';
import { RestDifferences } from './RestDifferences';
import { Legend, ShotGrid } from './ShotGrid';
import { StyleDetails } from './StyleDetails';

const styles = stylex.create({
  heading: { fontSize: cssVar.fontSizeLG, fontWeight: 600, marginBlock: 0 },
});

const AgentNote = ({ item }: { item: ReviewView }) =>
  item.note ? (
    <Alert
      description={item.note.finding}
      title={item.note.suggestion === 'pass' ? 'agent 建议通过' : 'agent 建议打回'}
      type={item.note.suggestion === 'pass' ? 'success' : 'error'}
      variant="soft"
    />
  ) : (
    <Alert
      description="截图之外还要读代码确认。agent 读完会在这里写一句结论，之后才能操作。"
      title="等 agent 读代码"
      type="info"
      variant="soft"
    />
  );

export const ReviewEvidence = ({
  conditions,
  item,
  notes = 'needed',
}: {
  conditions: string[];
  item: ReviewView;
  notes?: 'needed' | 'written';
}) => {
  const grid = reviewGrid(item.combos, conditions, item.comboDifferences);
  const visual = hasScreenshots(item);
  const note = notes === 'needed' ? item.needsAgent : Boolean(item.note);
  return (
    <Flexbox gap={24}>
      {item.category === 'blocking' && (
        <Alert
          description={item.errors[0] ?? '渲染失败'}
          title="没能渲染"
          type="error"
          variant="soft"
        />
      )}
      {note && <AgentNote item={item} />}
      {visual && (
        <Flexbox gap={16}>
          <Legend />
          <ShotGrid columns={grid.columns} item={item} rows={grid.rows} />
        </Flexbox>
      )}
      {visual && grid.states.columns.length > 0 && (
        <Flexbox gap={12}>
          <h2 {...stylex.props(styles.heading)}>交互状态</h2>
          <ShotGrid columns={grid.states.columns} item={item} rows={grid.states.rows} />
        </Flexbox>
      )}
      {visual && (
        <RestDifferences count={grid.restCount} differences={grid.restDifferences} item={item} />
      )}
      <StyleDetails item={item} />
    </Flexbox>
  );
};
