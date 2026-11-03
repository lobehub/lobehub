import { describe, expect, it } from 'vitest';

import { safeParseJSON } from './safeParseJSON';

describe('safeParseJSON', () => {
  it('should parse a valid JSON string', () => {
    const validJSON = '{"name": "John", "age": 30}';
    const result = safeParseJSON(validJSON);
    expect(result).toEqual({ name: 'John', age: 30 });
  });

  it('should return undefined for invalid JSON', () => {
    const invalidJSON = '{name: John}';
    const result = safeParseJSON(invalidJSON);
    expect(result).toBeUndefined();
  });

  it('should parse an empty object', () => {
    const emptyObject = '{}';
    const result = safeParseJSON(emptyObject);
    expect(result).toEqual({});
  });

  it('should parse an array', () => {
    const arrayJSON = '[1, 2, 3]';
    const result = safeParseJSON(arrayJSON);
    expect(result).toEqual([1, 2, 3]);
  });

  it('should parse nested objects', () => {
    const nestedJSON = '{"user": {"name": "John", "age": 30}}';
    const result = safeParseJSON(nestedJSON);
    expect(result).toEqual({ user: { name: 'John', age: 30 } });
  });

  it('should return undefined for an empty string', () => {
    const result = safeParseJSON('');
    expect(result).toBeUndefined();
  });

  it('should return undefined for non-string input', () => {
    // @ts-expect-error: Testing with invalid input type
    const result = safeParseJSON(123);
    expect(result).toBeUndefined();
  });

  it('should parse JSON with special characters', () => {
    const specialJSON = '{"message": "Hello, \\"world\\"!"}';
    const result = safeParseJSON(specialJSON);
    expect(result).toEqual({ message: 'Hello, "world"!' });
  });

  it('should parse large JSON without throwing an error', () => {
    const largeJSON = JSON.stringify({ data: Array.from({ length: 1000 }).fill('test') });
    const result = safeParseJSON(largeJSON);
    expect(result).toHaveProperty('data');
    expect(Array.isArray(result!.data)).toBe(true);
    expect(result!.data).toHaveLength(1000);
  });

  it('should handle JSON with different data types', () => {
    const mixedJSON = '{"string": "text", "number": 42, "boolean": true, "null": null}';
    const result = safeParseJSON(mixedJSON);
    expect(result).toEqual({
      string: 'text',
      number: 42,
      boolean: true,
      null: null,
    });
  });
});
