import { describe, expect, it } from 'vitest';

import { parseInternalLink } from './internalLink';

describe('parseInternalLink', () => {
  it('parses official agent document links', () => {
    expect(
      parseInternalLink('https://app.lobehub.com/agent/agt_agent/docs/document?mode=preview#title'),
    ).toEqual({
      agentId: 'agt_agent',
      documentId: 'docs_document',
      pathname: '/agent/agt_agent/docs/document?mode=preview#title',
      type: 'document',
    });
  });

  it('parses page links as document references', () => {
    expect(parseInternalLink('/page/page-1')).toEqual({
      documentId: 'docs_page-1',
      pathname: '/page/page-1',
      type: 'document',
    });
  });

  it('parses global and agent-scoped tasks', () => {
    expect(parseInternalLink('https://app.lobehub.com/task/T-198')).toEqual({
      pathname: '/task/T-198',
      taskId: 'T-198',
      type: 'task',
    });
    expect(parseInternalLink('/agent/agent-1/task/T-199')).toEqual({
      agentId: 'agt_agent-1',
      pathname: '/agent/agent-1/task/T-199',
      taskId: 'T-199',
      type: 'task',
    });
  });

  it('parses workspace-prefixed entity paths', () => {
    expect(parseInternalLink('/lobe-team/agent/agt_agent/docs/docs_document')).toEqual({
      agentId: 'agt_agent',
      documentId: 'docs_document',
      pathname: '/lobe-team/agent/agt_agent/docs/docs_document',
      type: 'document',
    });
  });

  it('accepts the current self-hosted origin', () => {
    expect(
      parseInternalLink('https://chat.example.com/task/T-200', 'https://chat.example.com'),
    ).toEqual({
      pathname: '/task/T-200',
      taskId: 'T-200',
      type: 'task',
    });
  });

  it('rejects external hosts even when their path resembles an app route', () => {
    expect(
      parseInternalLink('https://example.com/task/T-200', 'https://chat.example.com'),
    ).toBeNull();
  });

  it('parses agent roots and keeps deeper routes as SPA routes', () => {
    expect(parseInternalLink('/agent/agent-1')).toEqual({
      agentId: 'agt_agent-1',
      pathname: '/agent/agent-1',
      type: 'agent',
    });
    expect(parseInternalLink('/agent/agent-1/topics')).toEqual({
      pathname: '/agent/agent-1/topics',
      type: 'route',
    });
    expect(parseInternalLink('https://app.lobehub.com/settings/profile')).toEqual({
      pathname: '/settings/profile',
      type: 'route',
    });
  });
});
