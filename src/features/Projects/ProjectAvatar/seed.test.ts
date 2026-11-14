import { describe, expect, it } from 'vitest';

import { toProjectAvatarProps } from './seed';

describe('toProjectAvatarProps', () => {
  it('seeds the generated avatar from the project id, so typing or renaming keeps it', () => {
    const typing = toProjectAvatarProps({ id: 'prj_1', name: 'A' });
    const typed = toProjectAvatarProps({ id: 'prj_1', name: 'Apollo' });

    expect(typed.title).toBe(typing.title);
    expect(typed).toEqual({ alt: 'Apollo', avatar: undefined, title: 'prj_1' });
  });

  it("passes the project's own logo through", () => {
    expect(toProjectAvatarProps({ avatar: '🚀', id: 'prj_1', name: 'Apollo' }).avatar).toBe('🚀');
  });
});
