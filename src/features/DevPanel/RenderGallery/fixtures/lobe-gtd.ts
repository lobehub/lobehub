'use client';

import { defineFixtures, single, variants } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-gtd',
  fixtures: {
    clearTodos: single({
      pluginState: {
        todos: {
          items: [
            { status: 'completed', text: 'Capture real stream data' },
            { status: 'processing', text: 'Build /devtools route' },
          ],
        },
      },
    }),
    createPlan: single({
      pluginState: {
        plan: {
          context:
            'We want a reusable development-only page that renders every registered builtin tool card with a stable sample fixture.',
          description: 'Create a maintainable preview harness for builtin tool renders.',
          goal: 'Build /devtools render preview',
          id: 'plan_devtools_preview',
        },
      },
    }),
    createTodos: variants([
      {
        label: 'Mixed',
        pluginState: {
          todos: {
            items: [
              { status: 'completed', text: 'Enumerate all render entries' },
              { status: 'processing', text: 'Create preview fixtures' },
              { status: 'todo', text: 'Smoke test the route locally' },
            ],
          },
        },
      },
      {
        label: 'Many todos',
        pluginState: {
          todos: {
            items: Array.from({ length: 10 }, (_, i) => ({
              status: i < 3 ? 'completed' : i < 5 ? 'processing' : 'todo',
              text: `Subtask ${i + 1}: prepare fixtures for batch ${i + 1}`,
            })),
          },
        },
      },
      {
        label: 'All done',
        pluginState: {
          todos: {
            items: [
              { status: 'completed', text: 'Enumerate render entries' },
              { status: 'completed', text: 'Author preview fixtures' },
              { status: 'completed', text: 'Smoke-test the gallery' },
            ],
          },
        },
      },
    ]),
    execTask: single({
      pluginState: {
        task: {
          description: 'Smoke test the desktop router config',
          instruction:
            'Run the desktop router sync test and confirm /devtools only appears in development.',
        },
      },
    }),
    execTasks: single({
      pluginState: {
        tasks: [
          {
            description: 'Audit builtin render coverage',
            instruction: 'Find any registered render without a usable sample fixture.',
          },
          {
            description: 'Check route gating',
            instruction: 'Make sure production builds do not expose /devtools.',
          },
        ],
      },
    }),
    updatePlan: single({
      pluginState: {
        plan: {
          context:
            'The route is now in place; expand the preview harness by keeping fixture data next to the page.',
          description: 'Track the follow-up work for richer render fixtures.',
          goal: 'Expand /devtools coverage',
          id: 'plan_devtools_preview',
        },
      },
    }),
    updateTodos: single({
      pluginState: {
        todos: {
          items: [
            { status: 'completed', text: 'Export render registry entries' },
            { status: 'processing', text: 'Hydrate grouped task fixtures' },
            { status: 'todo', text: 'Add richer missing-state cases' },
          ],
        },
      },
    }),
  },
});
