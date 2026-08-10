import { describe, expect, it } from 'vitest';

import { BatchFileUploadFormFieldsSchema, FileUploadFormFieldsSchema } from './file.type';

describe('multipart upload field schemas', () => {
  it('parses explicit boolean fields without truthy-string coercion', () => {
    expect(
      FileUploadFormFieldsSchema.parse({
        skipCheckFileType: 'false',
        skipDeduplication: 'true',
      }),
    ).toMatchObject({ skipCheckFileType: false, skipDeduplication: true });
  });

  it('rejects invalid booleans and overlong ids', () => {
    expect(() => FileUploadFormFieldsSchema.parse({ skipCheckFileType: 'yes' })).toThrow();
    expect(() => FileUploadFormFieldsSchema.parse({ agentId: 'a'.repeat(256) })).toThrow();
  });

  it('rejects single-upload-only fields from batch payloads', () => {
    expect(BatchFileUploadFormFieldsSchema.safeParse({ skipDeduplication: 'true' }).success).toBe(
      false,
    );
    expect(BatchFileUploadFormFieldsSchema.shape).not.toHaveProperty('skipDeduplication');
  });

  // `pathname` was advertised in the multipart schema but never reached the storage
  // key, so a client could not actually control the object path. Keep it rejected
  // rather than silently ignored.
  it('rejects a client-supplied pathname on both upload schemas', () => {
    expect(FileUploadFormFieldsSchema.safeParse({ pathname: 'custom/path' }).success).toBe(false);
    expect(FileUploadFormFieldsSchema.shape).not.toHaveProperty('pathname');
    expect(BatchFileUploadFormFieldsSchema.shape).not.toHaveProperty('pathname');
  });
});
