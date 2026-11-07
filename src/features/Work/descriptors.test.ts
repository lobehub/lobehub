import { describe, expect, it } from 'vitest';

import { getWorkTypeDescriptor } from './descriptors';

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
});
