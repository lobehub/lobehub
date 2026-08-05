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
});
