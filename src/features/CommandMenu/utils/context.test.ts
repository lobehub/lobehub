import { describe, expect, it } from 'vitest';

import { detectContext } from './context';

describe('detectContext', () => {
  it('detects agent context for base and topic routes', () => {
    expect(detectContext('/agent/agt_123')).toBe('agent');
    expect(detectContext('/agent/agt_123/tpc_456')).toBe('agent');
  });

  it('keeps agent context for page routes nested under a topic', () => {
    expect(detectContext('/agent/agt_123/tpc_456/page')).toBe('agent');
    expect(detectContext('/agent/agt_123/tpc_456/page/doc_789')).toBe('agent');
  });

  it('preserves page context for standalone page routes', () => {
    expect(detectContext('/page/doc_789')).toBe('page');
  });

  it('falls back to general for unknown routes', () => {
    expect(detectContext('/unknown')).toBe('general');
  });
});
