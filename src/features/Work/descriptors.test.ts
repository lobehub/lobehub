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
