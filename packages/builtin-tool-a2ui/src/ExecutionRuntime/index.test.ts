import { describe, expect, it } from 'vitest';

import { A2uiExecutionRuntime } from './index';

const runtime = new A2uiExecutionRuntime();

describe('A2uiExecutionRuntime.renderUI', () => {
  it('stores a valid card in state and tells the model what it drew', async () => {
    const result = await runtime.renderUI({
      operations: [
        {
          updateComponents: {
            components: [
              { child: 'body', component: 'Card', id: 'root', title: 'Offsite plan' },
              { component: 'Text', id: 'body', text: 'Hike and a camp dinner' },
            ],
            surfaceId: 'plan',
          },
          version: '1.0',
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.state.surface).toMatchObject({ surfaceId: 'plan', title: 'Offsite plan' });
    expect(result.content).toContain('Offsite plan · Hike and a camp dinner');
  });

  it('returns the errors to fix, without state, for an invalid card', async () => {
    const result = await runtime.renderUI({
      operations: [
        {
          updateComponents: { components: [{ component: 'Map', id: 'root' }], surfaceId: 's' },
          version: '1.0',
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.state).toBeUndefined();
    expect(result.error.type).toBe('InvalidSurface');
    expect(result.content).toMatch(/Unknown component "Map"/);
  });
});
