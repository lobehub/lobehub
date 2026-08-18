import { describe, expect, it, vi } from 'vitest';

import {
  publishWorkspaceHtmlArtifact,
  wrapWorkspaceHtmlArtifact,
} from './publishWorkspaceHtmlArtifact';

describe('publishWorkspaceHtmlArtifact', () => {
  it('packs files, persists a closed html artifact, then publishes that message', async () => {
    const createMessage = vi.fn(
      async (_params: {
        agentId: string;
        content: string;
        role: 'assistant';
        topicId: string;
      }) => ({
        id: 'msg_1',
      }),
    );
    const publishArtifact = vi.fn(async () => ({
      latestRevisionNumber: 2,
      publicUrl: 'https://example.lobehub.com/page',
    }));

    const result = await publishWorkspaceHtmlArtifact(
      {
        agentId: 'agt_1',
        entryPath: 'index.html',
        files: [
          {
            content: '<html><title>Demo</title><link rel="stylesheet" href="app.css"></html>',
            contentType: 'text/html',
            encoding: 'utf8',
            path: 'index.html',
          },
          {
            content: 'body { color: red; }',
            contentType: 'text/css',
            encoding: 'utf8',
            path: 'app.css',
          },
        ],
        identifier: 'workspace-html-index-html',
        title: 'Demo',
        topicId: 'tpc_1',
      },
      { createMessage, publishArtifact },
    );

    expect(result).toEqual({
      publicUrl: 'https://example.lobehub.com/page',
      revision: 2,
    });
    const content = createMessage.mock.calls[0]?.[0]?.content ?? '';
    expect(createMessage).toHaveBeenCalledWith({
      agentId: 'agt_1',
      content,
      role: 'assistant',
      topicId: 'tpc_1',
    });
    expect(content).toContain('identifier="workspace-html-index-html"');
    expect(content).toContain('data:text/css;base64,');
    expect(content.startsWith('<lobeArtifact ')).toBe(true);
    expect(content.endsWith('</lobeArtifact>')).toBe(true);
    expect(content).toBe(
      wrapWorkspaceHtmlArtifact({
        html: content.replace(/^<lobeArtifact\b[^>]*>\n/u, '').replace(/\n<\/lobeArtifact>$/u, ''),
        identifier: 'workspace-html-index-html',
        title: 'Demo',
      }),
    );
    expect(publishArtifact).toHaveBeenCalledWith({
      artifactIdentifier: 'workspace-html-index-html',
      messageId: 'msg_1',
      requestedSlug: 'Demo',
      topicId: 'tpc_1',
    });
  });

  it('uploads files over the inline limit through publishSite', async () => {
    const publishSite = vi.fn(async () => ({
      latestRevisionNumber: 1,
      publicUrl: 'https://example.lobehub.com/page',
    }));
    const large = 'y'.repeat(32 * 1024 + 4);

    const result = await publishWorkspaceHtmlArtifact(
      {
        agentId: 'agt_1',
        entryPath: 'index.html',
        files: [
          {
            content: '<html><img src="hero.png"></html>',
            contentType: 'text/html',
            encoding: 'utf8',
            path: 'index.html',
          },
          {
            content: globalThis.btoa(large),
            contentType: 'image/png',
            encoding: 'base64',
            path: 'hero.png',
          },
        ],
        identifier: 'workspace-html-index-html',
        title: 'Demo',
        topicId: 'tpc_1',
      },
      {
        createMessage: vi.fn(),
        publishArtifact: vi.fn(),
        publishSite,
      },
    );

    expect(result.publicUrl).toBe('https://example.lobehub.com/page');
    expect(publishSite).toHaveBeenCalledWith({
      artifactIdentifier: 'workspace-html-index-html',
      files: [
        expect.objectContaining({
          path: '/hero.png',
        }),
      ],
      html: expect.stringContaining('src="/hero.png"'),
      requestedSlug: 'Demo',
      topicId: 'tpc_1',
    });
  });

  it('publishes a prepacked plan without re-packing the file set', async () => {
    const createMessage = vi.fn(
      async (_params: {
        agentId: string;
        content: string;
        role: 'assistant';
        topicId: string;
      }) => ({
        id: 'msg_1',
      }),
    );
    const publishArtifact = vi.fn(async () => ({ latestRevisionNumber: 1 }));

    await publishWorkspaceHtmlArtifact(
      {
        agentId: 'agt_1',
        entryPath: 'index.html',
        files: [
          {
            content: '<html><link rel="stylesheet" href="./app.css"></html>',
            contentType: 'text/html',
            encoding: 'utf8',
            path: 'index.html',
          },
        ],
        identifier: 'workspace-html-index-html',
        packed: { html: '<html>prepacked</html>', sidecars: [] },
        title: 'Demo',
        topicId: 'tpc_1',
      },
      { createMessage, publishArtifact },
    );

    expect(createMessage.mock.calls[0]?.[0]?.content).toContain('<html>prepacked</html>');
  });

  it('refuses to publish html that still points at unpacked local files', async () => {
    await expect(
      publishWorkspaceHtmlArtifact(
        {
          agentId: 'agt_1',
          entryPath: 'index.html',
          files: [
            {
              content: '<html><link rel="stylesheet" href="./app.css"></html>',
              contentType: 'text/html',
              encoding: 'utf8',
              path: 'index.html',
            },
          ],
          identifier: 'workspace-html-index-html',
          title: 'Demo',
          topicId: 'tpc_1',
        },
        {
          createMessage: vi.fn(),
          publishArtifact: vi.fn(),
        },
      ),
    ).rejects.toThrow('unresolved-local-assets');
  });

  it('refuses to publish without an agent', async () => {
    await expect(
      publishWorkspaceHtmlArtifact(
        {
          entryPath: 'index.html',
          files: [],
          identifier: 'workspace-html-index-html',
          title: 'Demo',
          topicId: 'tpc_1',
        },
        {
          createMessage: vi.fn(),
          publishArtifact: vi.fn(),
        },
      ),
    ).rejects.toThrow('unavailable');
  });
});
