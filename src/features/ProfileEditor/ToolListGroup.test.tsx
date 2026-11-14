import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ToolListGroup, { TOOL_ROWS_VISIBLE } from './ToolListGroup';

const rows = (n: number) => Array.from({ length: n }, (_, i) => <div key={i}>row-{i}</div>);

const renderGroup = (count: number) =>
  render(
    <ToolListGroup
      addControl={<button type="button">add</button>}
      emptyText="nothing yet"
      rows={rows(count)}
      title="Group"
    />,
  );

describe('ToolListGroup', () => {
  it('says so when the list is empty and still offers to add one', () => {
    renderGroup(0);

    expect(screen.getByText('nothing yet')).toBeTruthy();
    expect(screen.getByText('add')).toBeTruthy();
  });

  it('shows every row and the add control as the last row when the list is short', () => {
    renderGroup(3);

    expect(screen.getAllByText(/^row-/)).toHaveLength(3);
    expect(screen.getByText('add')).toBeTruthy();
    expect(screen.queryByText('settingAgent.tools.showAll')).toBeNull();
  });

  it('folds a long list after a few rows and opens the rest on request', () => {
    const total = TOOL_ROWS_VISIBLE + 5;
    renderGroup(total);

    expect(screen.getAllByText(/^row-/)).toHaveLength(TOOL_ROWS_VISIBLE);

    fireEvent.click(screen.getByText('settingAgent.tools.showAll'));
    expect(screen.getAllByText(/^row-/)).toHaveLength(total);

    fireEvent.click(screen.getByText('settingAgent.tools.showLess'));
    expect(screen.getAllByText(/^row-/)).toHaveLength(TOOL_ROWS_VISIBLE);
  });
});
