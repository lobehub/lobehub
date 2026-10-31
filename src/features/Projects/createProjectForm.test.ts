import { describe, expect, it } from 'vitest';

import {
  getCreateProjectInput,
  getProjectFieldSuggestions,
  isProjectIdentifierValid,
  isProjectSlugValid,
  PROJECT_SLUG_MAX_LENGTH,
} from './createProjectForm';

describe('createProjectForm', () => {
  it('derives only the slug from the project name, leaving the identifier to the user', () => {
    expect(getProjectFieldSuggestions('LobeHub')).toEqual({ slug: 'lobe-hub' });
    expect(getProjectFieldSuggestions('LobeHub Mobile')).toEqual({ slug: 'lobe-hub-mobile' });
    expect(getProjectFieldSuggestions('用户记忆')).toEqual({ slug: 'yong-hu-ji-yi' });
  });

  it('returns an empty suggestion when the project name is empty', () => {
    expect(getProjectFieldSuggestions('  ')).toEqual({ slug: '' });
  });

  it('bounds the generated slug so a long name still creates a project', () => {
    const longName = 'a'.repeat(120);
    const { slug } = getProjectFieldSuggestions(longName);

    expect(slug).toBe('a'.repeat(PROJECT_SLUG_MAX_LENGTH));
    expect(isProjectSlugValid(slug)).toBe(true);
    expect(getCreateProjectInput({ identifier: 'LOBE', name: longName, slug })).toEqual({
      identifier: 'LOBE',
      name: longName,
      slug: 'a'.repeat(PROJECT_SLUG_MAX_LENGTH),
    });
  });

  it('omits an empty identifier so tasks keep the default prefix', () => {
    expect(getCreateProjectInput({ identifier: '  ', name: 'LobeHub', slug: '' })).toEqual({
      name: 'LobeHub',
    });
  });

  it('rejects a filled identifier that is malformed', () => {
    expect(getCreateProjectInput({ identifier: 'AC', name: 'LobeHub', slug: '' })).toBeNull();
  });

  it('validates the identifier format shown by the form', () => {
    expect(isProjectIdentifierValid('LOBE')).toBe(true);
    expect(isProjectIdentifierValid('LH')).toBe(false);
    expect(isProjectIdentifierValid('1LOBE')).toBe(false);
  });

  it('normalizes and includes a user-provided slug', () => {
    expect(
      getCreateProjectInput({
        identifier: ' lobe ',
        name: '  LobeHub Project  ',
        slug: '  LobeHub-Project  ',
      }),
    ).toEqual({
      identifier: 'LOBE',
      name: 'LobeHub Project',
      slug: 'lobehub-project',
    });
  });

  it('omits an empty slug so the backend can generate one', () => {
    expect(
      getCreateProjectInput({ identifier: 'LOBE', name: 'LobeHub Project', slug: '  ' }),
    ).toEqual({ identifier: 'LOBE', name: 'LobeHub Project' });
  });

  it('rejects malformed slugs', () => {
    expect(isProjectSlugValid('two--hyphens')).toBe(false);
    expect(isProjectSlugValid('contains spaces')).toBe(false);
    expect(
      getCreateProjectInput({ identifier: 'LOBE', name: 'LobeHub Project', slug: '-invalid' }),
    ).toBeNull();
  });

  it('rejects a user-provided slug longer than the backend limit', () => {
    const overLongSlug = 'a'.repeat(PROJECT_SLUG_MAX_LENGTH + 1);

    expect(isProjectSlugValid(overLongSlug)).toBe(false);
    expect(
      getCreateProjectInput({ identifier: 'LOBE', name: 'LobeHub Project', slug: overLongSlug }),
    ).toBeNull();
  });
});
