import { describe, expect, it } from 'vitest';

import { openTargetOf } from './Deliverables';
import type { GoalArtifactView } from './goalGraphViewModel';

const artifact = (over: Partial<GoalArtifactView>): GoalArtifactView => ({
  createdAt: new Date(),
  identifier: null,
  nodeId: 'w1',
  resourceId: null,
  title: 'x',
  type: 'external',
  url: null,
  workId: 'wk1',
  workVersionId: 'v1',
  ...over,
});

describe('openTargetOf', () => {
  it('opens a bound document in-app, addressed by its document id', () => {
    expect(
      openTargetOf(artifact({ agentDocumentId: 'a-1', resourceId: 'docs_1', type: 'document' })),
    ).toEqual({ kind: 'document' });
  });

  it('opens a file and an external resource at their canonical url', () => {
    expect(openTargetOf(artifact({ type: 'file', url: 'https://cdn.example.com/a.pdf' }))).toEqual({
      kind: 'external',
      url: 'https://cdn.example.com/a.pdf',
    });
    expect(openTargetOf(artifact({ url: 'http://example.com/1' }))).toEqual({
      kind: 'external',
      url: 'http://example.com/1',
    });
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'notaurl'])(
    'refuses %s as a destination',
    (url) => {
      // On desktop `window.open` hands straight to `shell.openExternal`, so a
      // stored non-http(s) value must never become a clickable row.
      expect(openTargetOf(artifact({ url }))).toBeUndefined();
    },
  );

  it('has no destination when the artifact resolves to nothing', () => {
    // These rows must not render a pointer cursor, hover or a focusable button.
    expect(openTargetOf(artifact({ type: 'external', url: null }))).toBeUndefined();
    expect(openTargetOf(artifact({ type: 'file', url: null }))).toBeUndefined();
    expect(openTargetOf(artifact({ resourceId: null, type: 'document' }))).toBeUndefined();
  });
});
