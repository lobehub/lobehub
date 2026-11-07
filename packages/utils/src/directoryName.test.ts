import { describe, expect, it } from 'vitest';

import { isValidDirectoryName } from './directoryName';

describe('remote directory names', () => {
  it.each(['C:\\Users\\me', 'C:/Users/me', '\\\\server\\share', '//server/share'])(
    'applies Windows rules for %s',
    (parentPath) => {
      for (const name of ['CON', 'aux.txt', 'cOm9.log', 'LPT¹', 'x:y', 'x\u001Fy', 'x.', 'x ']) {
        expect(isValidDirectoryName(name, parentPath), name).toBe(false);
      }
      for (const name of ['project', '.config', 'COM10', 'console', 'my project']) {
        expect(isValidDirectoryName(name, parentPath), name).toBe(true);
      }
    },
  );

  it.each(['CON', 'a:b', 'a*b', 'project.', 'project '])(
    'preserves legal POSIX name %j',
    (name) => {
      expect(isValidDirectoryName(name, '/home/me')).toBe(true);
    },
  );
});
