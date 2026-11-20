import { expect, it } from 'vitest';

import { renderProjectList } from './render';

it('shows no task rows for a project with no tasks', () => {
  const view = renderProjectList({ tasks: [] });
  expect(view.taskRows).toEqual([]);
  expect(view.message).toBe('No tasks yet');
});
