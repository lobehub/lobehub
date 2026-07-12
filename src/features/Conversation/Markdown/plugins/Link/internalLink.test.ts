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
      agentId: 'agent-1',
      pathname: '/agent/agent-1/task/T-199',
      taskId: 'T-199',
      type: 'task',
    });
  });

  it('parses verification report links', () => {
    expect(parseInternalLink('https://app.lobehub.com/verify/run-1')).toEqual({
      pathname: '/verify/run-1',
      runId: 'run-1',
      type: 'verify',
    });
    expect(parseInternalLink('/lobe-team/verify/run-2', undefined, ['lobe-team'])).toEqual({
      pathname: '/lobe-team/verify/run-2',
      runId: 'run-2',
      type: 'verify',
      workspaceSlug: 'lobe-team',
    });
  });

  it('parses workspace-prefixed entity paths', () => {
    expect(
      parseInternalLink('/lobe-team/agent/agt_agent/docs/docs_document', undefined, ['lobe-team']),
    ).toEqual({
      agentId: 'agt_agent',
      documentId: 'docs_document',
      pathname: '/lobe-team/agent/agt_agent/docs/docs_document',
      type: 'document',
      workspaceSlug: 'lobe-team',
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
    expect(
      parseInternalLink('https://app.lobehub.com/task/T-200', 'https://chat.example.com'),
    ).toBeNull();
  });

  it('accepts official links from the Electron renderer origin', () => {
    expect(parseInternalLink('https://app.lobehub.com/task/T-201', 'app://renderer')).toEqual({
      pathname: '/task/T-201',
      taskId: 'T-201',
      type: 'task',
    });
  });

  it('preserves workspace context for workspace-prefixed SPA routes', () => {
    expect(parseInternalLink('/lobe-team/tasks', undefined, ['lobe-team'])).toEqual({
      pathname: '/lobe-team/tasks',
      type: 'route',
      workspaceSlug: 'lobe-team',
    });
  });

  it('rejects external hosts even when their path resembles an app route', () => {
    expect(
      parseInternalLink('https://example.com/task/T-200', 'https://chat.example.com'),
    ).toBeNull();
    expect(parseInternalLink('//example.com/task/T-200', 'https://chat.example.com')).toBeNull();
  });

  it('parses agent roots and keeps deeper routes as SPA routes', () => {
    expect(parseInternalLink('/agent/agent-1')).toEqual({
      agentId: 'agent-1',
      pathname: '/agent/agent-1',
      type: 'agent',
    });
    expect(parseInternalLink('/agent/custom-agent-id-123/docs/foo')).toEqual({
      agentId: 'custom-agent-id-123',
      documentId: 'docs_foo',
      pathname: '/agent/custom-agent-id-123/docs/foo',
      type: 'document',
    });
    expect(parseInternalLink('/agent/agent-1/topics')).toEqual({
      pathname: '/agent/agent-1/topics',
      type: 'route',
    });
    expect(parseInternalLink('/agent/inbox')).toEqual({
      pathname: '/agent/inbox',
      type: 'route',
    });
    expect(parseInternalLink('https://app.lobehub.com/settings/profile')).toEqual({
      pathname: '/settings/profile',
      type: 'route',
    });
  });

  it('leaves same-origin backend and framework links to the browser', () => {
    expect(parseInternalLink('/api/agent/stream?operationId=op_1')).toBeNull();
    expect(parseInternalLink('/f/generated-file-id')).toBeNull();
    expect(parseInternalLink('https://app.lobehub.com/f/generated-file-id')).toBeNull();
    expect(parseInternalLink('/trpc/lambda')).toBeNull();
    expect(parseInternalLink('/webapi/chat')).toBeNull();
    expect(parseInternalLink('/_next/static/chunks/app.js')).toBeNull();
    expect(parseInternalLink('/favicon.ico')).toBeNull();
    expect(parseInternalLink('/manifest.webmanifest')).toBeNull();
    expect(parseInternalLink('/.well-known/assetlinks.json')).toBeNull();
  });
});
