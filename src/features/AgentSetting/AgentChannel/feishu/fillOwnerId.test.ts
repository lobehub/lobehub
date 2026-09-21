import { describe, expect, it, vi } from 'vitest';

import { fillOwnerId } from './fillOwnerId';

describe('fillOwnerId', () => {
  it.each(['unchanged', 'user-id', 'cleared', 'app-id', 'secret', 'superseded'])(
    'handles %s form state while an owner lookup is pending',
    async (change) => {
      const fields: Record<string, unknown> = {
        'applicationId': 'app-a',
        'credentials.appSecret': 'secret-a',
        'settings.userId': '',
      };
      let touched = false;
      let current = true;
      let resolve!: (owner: { openId: string }) => void;
      const response = new Promise<{ openId: string }>((done) => {
        resolve = done;
      });
      const form = {
        getFieldValue: (name: string | string[]) =>
          fields[Array.isArray(name) ? name.join('.') : name],
        isFieldTouched: () => touched,
        setFieldValue: vi.fn((name: string[], value: string) => {
          fields[name.join('.')] = value;
        }),
      };
      const pending = fillOwnerId({
        credentials: { appId: 'app-a', appSecret: 'secret-a', platform: 'feishu' },
        fetchOwner: () => response,
        form,
        isCurrent: () => current,
      });
      if (change === 'user-id') fields['settings.userId'] = 'deliberate-user';
      if (change === 'cleared') touched = true;
      if (change === 'app-id') fields.applicationId = 'app-b';
      if (change === 'secret') fields['credentials.appSecret'] = 'secret-b';
      if (change === 'superseded') current = false;
      resolve({ openId: 'app-owner' });

      const result = await pending;

      if (change === 'unchanged') {
        expect(result).toEqual({ openId: 'app-owner' });
        expect(fields['settings.userId']).toBe('app-owner');
      } else {
        expect(result).toBeUndefined();
        expect(form.setFieldValue).not.toHaveBeenCalled();
      }
    },
  );
});
