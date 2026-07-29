'use client';

import { defineFixtures, single } from './_helpers';

// list_teams returns a flat collection of entities whose only metadata is
// createdAt / updatedAt — the canonical case for the compact inline meta row.
export default defineFixtures({
  identifier: 'linear',
  apiList: [{ description: 'List all teams in the workspace', name: 'list_teams' }],
  fixtures: {
    list_teams: single({
      args: {},
      content: JSON.stringify({
        teams: [
          {
            createdAt: '2024-10-17T07:58:43.000Z',
            id: '55a0597c-be21-4e73-a1ff-1a45aedf0184',
            name: 'Engineering',
            updatedAt: '2026-06-27T07:15:25.000Z',
          },
          {
            createdAt: '2025-11-12T09:06:23.000Z',
            id: '86bed308-b8fd-4c90-aa64-144b80e8f3f2',
            name: 'Packaging',
            updatedAt: '2026-06-27T07:15:25.000Z',
          },
          {
            createdAt: '2026-02-04T10:38:25.000Z',
            id: '6c136d2c-fe29-41bf-9fc8-3aefa39e895b',
            name: 'Benchmark',
            updatedAt: '2026-06-23T07:13:04.000Z',
          },
          {
            createdAt: '2026-01-22T09:36:47.000Z',
            id: '158f2b2d-34ba-48a3-84c9-084f5dd6d2f4',
            name: 'QA',
            updatedAt: '2026-06-15T07:09:01.000Z',
          },
        ],
      }),
    }),
  },
});
