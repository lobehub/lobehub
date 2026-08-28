import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemRole';

describe('systemPrompt', () => {
  it('should distinguish agent document ids from folder navigation ids', () => {
    expect(systemPrompt).toContain("For read and mutation calls, pass the result's `id`.");
    expect(systemPrompt).toContain(
      "For folder navigation, pass the folder's `documentId` (or the ID shown in a collapsed folder row) as `listDocuments.parentId`.",
    );
  });
});
