// Fixture: an imported registry adapter called with `{} as never` inputs; its body is not
// in this file.
import { expect, it } from 'vitest';

import { WorkModel } from '..';
import { goalReportWorkAdapter } from '../goalReport';
import { registerReport, serverDB, userId } from './_fixtures';

it('finds the newest report version of a goal', async () => {
  const model = new WorkModel(serverDB, userId);
  await registerReport(model, { content: '# First', toolCallId: 'v1' });
  await registerReport(model, { content: '# Second', toolCallId: 'v2' });

  expect(await model.findLatestGoalReport('goal-1')).toMatchObject({ version: 2 });
});

it('exposes a registry adapter that never lists goal reports', async () => {
  await expect(goalReportWorkAdapter.listConversationRows({} as never)).resolves.toEqual([]);
  await expect(goalReportWorkAdapter.listVersionEvents({} as never)).resolves.toEqual([]);
  expect(() => goalReportWorkAdapter.mapCurrentRow({} as never)).toThrow(
    'goal_report Works are not listed',
  );
});
