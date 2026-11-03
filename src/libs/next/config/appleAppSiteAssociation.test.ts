import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const associationPath = path.resolve(
  import.meta.dirname,
  '../../../../public/.well-known/apple-app-site-association',
);

describe('apple-app-site-association', () => {
  it('opens only the agent approval route as a universal link and preserves web credentials', () => {
    const association = JSON.parse(readFileSync(associationPath, 'utf8'));

    expect(association).toEqual({
      applinks: {
        details: [
          {
            appIDs: ['4684H589ZU.com.lobehub.app'],
            components: [{ '/': '/agent-approval' }],
          },
        ],
      },
      webcredentials: {
        apps: ['4684H589ZU.com.lobehub.app'],
      },
    });
  });
});
