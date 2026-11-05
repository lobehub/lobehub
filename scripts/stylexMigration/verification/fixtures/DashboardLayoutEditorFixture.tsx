import { DashboardLayoutEditor } from 'verification:component';

const noop = () => {};

const entry = (id: string, title: string) => ({
  item: { id },
  view: undefined,
  widget: { id: `widget-${id}`, title, userId: 'fixture-user' },
});

const items = [entry('a', 'Weekly active agents'), entry('b', 'Tool call success rate')];

export const Fixture = () => (
  <DashboardLayoutEditor
    dashboardId="fixture-dashboard"
    items={items}
    initialLayouts={{
      a: { h: 3, w: 6, x: 0, y: 0 },
      b: { h: 3, w: 6, x: 6, y: 0 },
    }}
    onDone={noop}
  />
);
