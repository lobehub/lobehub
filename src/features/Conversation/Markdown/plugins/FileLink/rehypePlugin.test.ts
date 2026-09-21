import type * as LobechatConstModule from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useElectronStore } from '@/store/electron';

import { LOBE_FILE_LINK_TAG } from './parse';
import { rehypeFileLink } from './rehypePlugin';

const mockConstEnv = vi.hoisted(() => ({ isDesktop: false }));

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof LobechatConstModule>();
  return {
    ...actual,
    get isDesktop() {
      return mockConstEnv.isDesktop;
    },
  };
});

const run = (tree: any) => rehypeFileLink()(tree);

const ORIGIN = () => window.location.origin;

beforeEach(() => {
  mockConstEnv.isDesktop = false;
  useElectronStore.setState({ dataSyncConfig: { storageMode: 'cloud' } });
});

describe('rehypeFileLink', () => {
  it('retags an absolute, same-origin file proxy link', () => {
    const href = `${ORIGIN()}/f/file_abc123`;
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: { href },
          children: [{ type: 'text', value: 'bubble_sort.py' }],
        },
      ],
    };

    run(tree);

    const node = (tree as any).children[0];
    expect(node.tagName).toBe(LOBE_FILE_LINK_TAG);
    expect(node.properties).toEqual({
      fileId: 'file_abc123',
      linkHref: href,
      linkLabel: 'bubble_sort.py',
    });
    expect(node.children).toEqual([]);
  });

  it('retags a relative file proxy link', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: { href: '/f/file_xyz' },
          children: [{ type: 'text', value: 'report.xlsx' }],
        },
      ],
    };

    run(tree);

    const node = (tree as any).children[0];
    expect(node.tagName).toBe(LOBE_FILE_LINK_TAG);
    expect(node.properties.fileId).toBe('file_xyz');
  });

  it('falls back to the file id as label when the link has no text', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'element', tagName: 'a', properties: { href: '/f/file_xyz' }, children: [] },
      ],
    };

    run(tree);

    expect((tree as any).children[0].properties.linkLabel).toBe('file_xyz');
  });

  it('does not intercept a cross-origin link sharing the same path shape', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: { href: 'https://example.com/f/not-ours' },
          children: [{ type: 'text', value: 'not-ours' }],
        },
      ],
    };

    run(tree);

    expect((tree as any).children[0].tagName).toBe('a');
  });

  it('leaves a normal external link untouched', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: { href: 'https://example.com/docs' },
          children: [{ type: 'text', value: 'docs' }],
        },
      ],
    };

    run(tree);

    expect((tree as any).children[0].tagName).toBe('a');
  });

  it('leaves non-anchor elements untouched', () => {
    const tree = {
      type: 'root',
      children: [{ type: 'element', tagName: 'p', properties: {}, children: [] }],
    };

    run(tree);

    expect((tree as any).children[0].tagName).toBe('p');
  });

  describe('desktop', () => {
    beforeEach(() => {
      mockConstEnv.isDesktop = true;
    });

    it('classifies against the official cloud origin, not the renderer origin', () => {
      useElectronStore.setState({ dataSyncConfig: { storageMode: 'cloud' } });

      const tree = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'a',
            properties: { href: 'https://app.lobehub.com/f/file_abc123' },
            children: [{ type: 'text', value: 'bubble_sort.py' }],
          },
        ],
      };

      run(tree);

      expect((tree as any).children[0].tagName).toBe(LOBE_FILE_LINK_TAG);
    });

    it('classifies against the configured self-hosted remote server origin', () => {
      useElectronStore.setState({
        dataSyncConfig: {
          remoteServerUrl: 'https://my-server.example.com',
          storageMode: 'selfHost',
        },
      });

      const tree = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'a',
            properties: { href: 'https://my-server.example.com/f/file_abc123' },
            children: [{ type: 'text', value: 'bubble_sort.py' }],
          },
        ],
      };

      run(tree);

      expect((tree as any).children[0].tagName).toBe(LOBE_FILE_LINK_TAG);
    });

    it('still rejects a link to a different origin than the configured remote server', () => {
      useElectronStore.setState({
        dataSyncConfig: {
          remoteServerUrl: 'https://my-server.example.com',
          storageMode: 'selfHost',
        },
      });

      const tree = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'a',
            properties: { href: 'https://example.com/f/not-ours' },
            children: [{ type: 'text', value: 'not-ours' }],
          },
        ],
      };

      run(tree);

      expect((tree as any).children[0].tagName).toBe('a');
    });
  });
});
