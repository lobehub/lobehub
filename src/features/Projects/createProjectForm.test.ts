import { describe, expect, it } from 'vitest';

import {
  buildCreateProjectRequest,
  DEFAULT_MAIN_AGENT_MODE,
  doesConflictApplyTo,
  getCreateProjectInput,
  getProjectFieldSuggestions,
  isProjectIdentifierTaken,
  isProjectIdentifierValid,
  isProjectSlugValid,
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

  it('flags an identifier that another project in the scope already uses', () => {
    const projects = [{ identifier: 'LOBE' }, { identifier: 'MOBILE' }];

    expect(isProjectIdentifierTaken('LOBE', projects)).toBe(true);
    expect(isProjectIdentifierTaken(' lobe ', projects)).toBe(true);
    expect(isProjectIdentifierTaken('LOB', projects)).toBe(false);
    // An empty field is "not yet filled in", not "taken".
    expect(isProjectIdentifierTaken('  ', projects)).toBe(false);
    expect(isProjectIdentifierTaken('LOBE', [])).toBe(false);
  });

  it('attributes a server conflict only to the identifier that was submitted', () => {
    // Unchanged field: the conflict the server reported still describes it.
    expect(doesConflictApplyTo('LOBE', 'LOBE')).toBe(true);
    expect(doesConflictApplyTo('LOBE', ' lobe ')).toBe(true);

    // Typed a new value while the request was in flight: the verdict is stale.
    expect(doesConflictApplyTo('LOBE', 'MOBILE')).toBe(false);

    // Nothing was submitted, so there is no identifier to blame.
    expect(doesConflictApplyTo('', '')).toBe(false);
    expect(doesConflictApplyTo('', 'MOBILE')).toBe(false);
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

  it('leaves the main agent out so the server creates a dedicated one', () => {
    expect(
      buildCreateProjectRequest(
        { name: 'Launch' },
        { avatar: '🚀', mainAgentId: 'inbox', mainAgentMode: 'dedicated' },
      ),
    ).toEqual({ avatar: '🚀', name: 'Launch' });
  });

  it('creates a dedicated main agent by default', () => {
    expect(
      buildCreateProjectRequest(
        { name: 'Launch' },
        { mainAgentId: 'inbox', mainAgentMode: DEFAULT_MAIN_AGENT_MODE },
      ),
    ).toEqual({ name: 'Launch' });
  });

  it('sends the picked agent when the project reuses an existing one', () => {
    expect(
      buildCreateProjectRequest(
        { name: 'Launch', slug: 'launch' },
        { mainAgentId: 'agt_1', mainAgentMode: 'existing' },
      ),
    ).toEqual({ coordinatorAgentId: 'agt_1', name: 'Launch', slug: 'launch' });
  });

  it('sends neither a project type nor a site, whatever the caller passes', () => {
    expect(
      buildCreateProjectRequest({ name: 'Launch' }, {
        mainAgentMode: 'dedicated',
        siteOrigin: 'https://launch.dev',
        type: 'web',
      } as never),
    ).toEqual({ name: 'Launch' });
  });
});
