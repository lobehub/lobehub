import { describe, expect, it } from 'vitest';

import {
  getCollectionCoverUrl,
  getCollectionFanUrls,
  getCollectionImageCount,
  getWorkTypeDescriptor,
} from './descriptors';

describe('getWorkTypeDescriptor', () => {
  it('returns a usable fallback descriptor for an unknown work type', () => {
    // Simulate a Work type the server registry gained after this client shipped:
    // the lookup must degrade to a generic descriptor instead of returning
    // undefined and crashing the works UI on `descriptor.getIcon(item)`.
    const item = {
      description: 'A brand new kind of work',
      id: 'work-future-1',
      identifier: 'FUTURE-1',
      resourceId: 'resource-1',
      title: 'Future Work',
      type: 'future-type-not-yet-known',
    } as any;

    const descriptor = getWorkTypeDescriptor(item);

    expect(() => descriptor.getIcon(item)).not.toThrow();
    expect(descriptor.getIcon(item)).toBeTruthy();
    expect(descriptor.getTitle(item)).toBe('Future Work');
    expect(descriptor.getIdentifier(item)).toBe('FUTURE-1');
    expect(descriptor.getDescription(item)).toBe('A brand new kind of work');
    // Unknown types expose no open action, so their cards render inert.
    expect(descriptor.getOpenTarget(item)).toBeNull();
  });

  describe('file open target', () => {
    const baseFileItem = {
      description: '/tmp/deck/slides.pptx',
      id: 'work-file-1',
      identifier: 'slides.pptx',
      resourceId: 'user:topic:/tmp/deck/slides.pptx',
      title: 'slides.pptx',
      type: 'file',
    };

    it('prefers the in-app file preview when the summary metadata carries a fileId', () => {
      const item = {
        ...baseFileItem,
        event: { metadata: { fileId: 'file-1', fileUrl: 'https://cdn.example.com/f/1' } },
        url: 'https://cdn.example.com/f/1',
      } as any;

      expect(getWorkTypeDescriptor(item).getOpenTarget(item)).toEqual({
        fileId: 'file-1',
        kind: 'filePreview',
        url: 'https://cdn.example.com/f/1',
      });
    });

    it('omits the url fallback when the persisted url is not http(s)', () => {
      const item = {
        ...baseFileItem,
        event: { metadata: { fileId: 'file-1', fileUrl: 'javascript:alert(1)' } },
        url: null,
      } as any;

      expect(getWorkTypeDescriptor(item).getOpenTarget(item)).toEqual({
        fileId: 'file-1',
        kind: 'filePreview',
        url: undefined,
      });
    });

    it('falls back to the external url for list rows without version metadata', () => {
      const item = { ...baseFileItem, url: 'https://cdn.example.com/f/1' } as any;

      expect(getWorkTypeDescriptor(item).getOpenTarget(item)).toEqual({
        kind: 'external',
        url: 'https://cdn.example.com/f/1',
      });
    });

    it('shows the description an agent gave the file over its path', () => {
      const item = {
        ...baseFileItem,
        description: 'Quarterly numbers for the board',
        event: { metadata: { filePath: '/tmp/deck/slides.pptx' } },
      } as any;

      expect(getWorkTypeDescriptor(item).getDescription(item)).toBe(
        'Quarterly numbers for the board',
      );
    });

    it('shows the title an agent gave the file over the file name', () => {
      const item = { ...baseFileItem, title: 'Q3 report' } as any;

      expect(getWorkTypeDescriptor(item).getTitle(item)).toBe('Q3 report');
    });

    it('falls back to the file name when the row has no title', () => {
      const item = { ...baseFileItem, title: '' } as any;

      expect(getWorkTypeDescriptor(item).getTitle(item)).toBe('slides.pptx');
    });

    it('yields no target when neither fileId nor a safe url exists', () => {
      const item = { ...baseFileItem, url: null } as any;

      expect(getWorkTypeDescriptor(item).getOpenTarget(item)).toBeNull();
    });
  });

  it('still resolves a known type to its concrete descriptor', () => {
    const item = {
      description: 'Doc body',
      id: 'work-doc-1',
      identifier: 'DOC-1',
      resourceId: 'doc-1',
      title: 'A document',
      type: 'document',
    } as any;

    const descriptor = getWorkTypeDescriptor(item);
    expect(descriptor.getOpenTarget(item)).toEqual({
      agentDocumentId: undefined,
      documentId: 'doc-1',
      kind: 'document',
    });
  });

  describe('collection', () => {
    const image = (n: number) => ({
      fileId: `file-${n}`,
      mimeType: 'image/png',
      url: `https://app.example.com/f/file-${n}`,
    });
    const listRow = {
      description: null,
      id: 'work-collection-1',
      identifier: null,
      resourceId: 'col_1',
      resourceType: 'collection',
      title: 'Top ten CD shelf',
      type: 'collection',
      url: 'https://app.example.com/f/file-2',
    };
    const summaryRow = {
      ...listRow,
      event: { metadata: { collection: { coverFileId: 'file-2', items: [image(1), image(2)] } } },
    };

    it('opens the viewer with the images a summary row carries', () => {
      const item = summaryRow as any;

      expect(getWorkTypeDescriptor(item).getOpenTarget(item)).toEqual({
        items: [image(1), image(2)],
        kind: 'collection',
        title: 'Top ten CD shelf',
        workId: 'work-collection-1',
      });
      expect(getCollectionImageCount(item)).toBe(2);
      expect(getCollectionCoverUrl(item)).toBe(image(2).url);
    });

    it('leaves loading the images to the viewer for a list row', () => {
      const item = listRow as any;

      expect(getWorkTypeDescriptor(item).getOpenTarget(item)).toEqual({
        items: undefined,
        kind: 'collection',
        title: 'Top ten CD shelf',
        workId: 'work-collection-1',
      });
      expect(getCollectionImageCount(item)).toBeNull();
      // List rows show the cover denormalized into works.url.
      expect(getCollectionCoverUrl(item)).toBe('https://app.example.com/f/file-2');
    });

    it('falls back to the first image without a named cover, and drops non-http(s) covers', () => {
      const firstImage = {
        ...summaryRow,
        event: { metadata: { collection: { items: [image(3), image(1)] } } },
      } as any;
      expect(getCollectionCoverUrl(firstImage)).toBe(image(3).url);

      const unsafe = { ...listRow, url: 'javascript:alert(1)' } as any;
      expect(getCollectionCoverUrl(unsafe)).toBeNull();
    });

    it('fans out up to three images with the cover in front', () => {
      const four = {
        ...summaryRow,
        event: {
          metadata: {
            collection: { coverFileId: 'file-3', items: [image(1), image(2), image(3), image(4)] },
          },
        },
      } as any;
      expect(getCollectionFanUrls(four)).toEqual([image(3).url, image(1).url, image(2).url]);
      // A list row knows only the cover, so there is nothing to fan.
      expect(getCollectionFanUrls(listRow as any)).toEqual(['https://app.example.com/f/file-2']);
    });
  });

  describe('canvas open target', () => {
    const canvasItem = (eventVersion: number, currentVersion: number) =>
      ({
        event: { version: eventVersion },
        id: 'work-canvas-1',
        resourceId: 'cvs_1',
        title: 'Report',
        type: 'canvas',
        version: { version: currentVersion },
      }) as any;

    it('follows the latest version when the card is the current version', () => {
      const item = canvasItem(2, 2);

      expect(getWorkTypeDescriptor(item).getOpenTarget(item)).toEqual({
        canvasId: 'cvs_1',
        kind: 'canvas',
      });
    });

    it('pins the version when the card shows an older version', () => {
      const item = canvasItem(1, 2);

      expect(getWorkTypeDescriptor(item).getOpenTarget(item)).toEqual({
        canvasId: 'cvs_1',
        kind: 'canvas',
        version: 1,
      });
    });
  });

  describe('external GitHub state and branch', () => {
    const githubItem = (overrides: Record<string, unknown> = {}) =>
      ({
        description: null,
        id: 'work-gh-1',
        identifier: 'lobehub/lobehub#1',
        resourceId: 'lobehub/lobehub#1',
        resourceType: 'github_pull_request',
        status: 'open',
        title: 'A PR',
        type: 'external',
        ...overrides,
      }) as any;

    it('draws each PR state with its own stable glyph and keeps the brand icon otherwise', () => {
      const iconOf = (overrides: Record<string, unknown>) => {
        const item = githubItem(overrides);
        return getWorkTypeDescriptor(item).getIcon(item);
      };

      const states = ['open', 'draft', 'merged', 'closed'].map((status) => iconOf({ status }));
      expect(new Set(states).size).toBe(4);
      // Stable identity: the card must not remount its icon on every render.
      expect(iconOf({ status: 'open' })).toBe(states[0]);
      // GraphQL-style uppercase states resolve the same way.
      expect(iconOf({ status: 'MERGED' })).toBe(states[2]);

      const brand = iconOf({ status: null });
      expect(states).not.toContain(brand);
      expect(iconOf({ status: 'constructor' })).toBe(brand);
      expect(iconOf({ resourceType: 'github_issue', status: 'open' })).not.toBe(brand);
    });

    it('labels the drawn state for the icon tooltip, and nothing when the icon is the brand', () => {
      const labelOf = (overrides: Record<string, unknown>) => {
        const item = githubItem(overrides);
        return getWorkTypeDescriptor(item).getStateLabelKey?.(item);
      };

      expect(labelOf({ status: 'draft' })).toBe('metaCard.pr.draft');
      expect(labelOf({ status: 'merged' })).toBe('metaCard.pr.merged');
      expect(labelOf({ resourceType: 'github_issue', status: 'closed' })).toBe(
        'metaCard.pr.closed',
      );
      expect(labelOf({ status: null })).toBeNull();
    });

    it('marks every GitHub identifier with the GitHub logo, and no other provider', () => {
      const markOf = (overrides: Record<string, unknown>) => {
        const item = githubItem(overrides);
        return getWorkTypeDescriptor(item).getIdentifierIcon?.(item);
      };

      const prMark = markOf({ status: 'open' });
      expect(prMark).toBeTruthy();
      // Same mark whether the main icon is a state glyph or already the brand logo.
      expect(markOf({ status: null })).toBe(prMark);
      expect(markOf({ resourceType: 'github_issue', status: 'closed' })).toBe(prMark);
      expect(markOf({ resourceType: 'linear_issue', status: 'In Progress' })).toBeNull();
    });

    it('reads the head/base branch from the summary metadata only for pull requests', () => {
      const withBranch = githubItem({
        event: { metadata: { baseBranch: 'canary', headBranch: 'feat/x' } },
      });
      const descriptor = getWorkTypeDescriptor(withBranch);

      expect(descriptor.getBranch?.(withBranch)).toEqual({ base: 'canary', head: 'feat/x' });
      expect(descriptor.getBranch?.(githubItem())).toBeNull();
      expect(
        descriptor.getBranch?.(
          githubItem({
            event: { metadata: { headBranch: 'feat/x' } },
            resourceType: 'github_issue',
          }),
        ),
      ).toBeNull();
    });

    it('drops the status fallback from the GitHub description but keeps it for Linear', () => {
      const github = githubItem();
      expect(getWorkTypeDescriptor(github).getDescription(github)).toBeNull();

      const linear = {
        description: null,
        id: 'work-linear-1',
        resourceType: 'linear_issue',
        status: 'In Progress',
        type: 'external',
      } as any;
      expect(getWorkTypeDescriptor(linear).getDescription(linear)).toBe('In Progress');
    });
  });

  describe('artboard open target', () => {
    it('opens the board it records', () => {
      const item = { resourceId: 'art_1', title: '首次进入', type: 'artboard' } as any;
      expect(getWorkTypeDescriptor(item).getOpenTarget(item)).toEqual({
        artboardId: 'art_1',
        kind: 'artboard',
      });
    });

    it('has nothing to open without a board id', () => {
      const item = { resourceId: null, title: 'x', type: 'artboard' } as any;
      expect(getWorkTypeDescriptor(item).getOpenTarget(item)).toBeNull();
    });
  });
});
