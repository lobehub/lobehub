import { describe, expect, it } from 'vitest';

import { normalizeTfsCollection, parseTfsRepository, shortTfsBranch } from './tfs';

describe('TFS URL helpers', () => {
  const collection = 'http://dev.tellhowsoft.com/DefaultCollection';
  it('canonicalizes a repository and strips the branch ref', () => {
    expect(
      parseTfsRepository(`${collection}/RSMP/cloud-admin-ui/../_git/cloud-admin-ui`),
    ).toBeNull();
    expect(parseTfsRepository(`${collection}/RSMP/_git/cloud-admin-ui/`, collection)).toMatchObject(
      {
        project: 'RSMP',
        name: 'cloud-admin-ui',
        fullName: 'RSMP/cloud-admin-ui',
        url: `${collection}/RSMP/_git/cloud-admin-ui`,
      },
    );
    expect(shortTfsBranch('refs/heads/master')).toBe('master');
  });
  it('rejects credentials, query strings, fragments and another collection', () => {
    expect(normalizeTfsCollection(`${collection}/`)).toBe(collection);
    expect(
      parseTfsRepository(`http://user:pass@dev.tellhowsoft.com/DefaultCollection/RSMP/_git/x`),
    ).toBeNull();
    expect(parseTfsRepository(`${collection}/RSMP/_git/x?token=secret`)).toBeNull();
    expect(parseTfsRepository(`${collection}/RSMP/_git/x#readme`)).toBeNull();
    expect(parseTfsRepository('http://other/DefaultCollection/RSMP/_git/x', collection)).toBeNull();
  });
  it('rejects encoded path traversal and unsupported collection URLs', () => {
    expect(parseTfsRepository(`${collection}/RSMP%2F..%2Fother/_git/x`, collection)).toBeNull();
    expect(() => normalizeTfsCollection(`${collection}//`)).toThrow();
    expect(() => normalizeTfsCollection('ftp://dev.tellhowsoft.com/DefaultCollection')).toThrow();
  });
});
