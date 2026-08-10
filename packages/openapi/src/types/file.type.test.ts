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
    expect(BatchFileUploadFormFieldsSchema.safeParse({ pathname: 'custom/path' }).success).toBe(
      false,
    );
    expect(BatchFileUploadFormFieldsSchema.shape).not.toHaveProperty('pathname');
    expect(BatchFileUploadFormFieldsSchema.shape).not.toHaveProperty('skipDeduplication');
  });
});
