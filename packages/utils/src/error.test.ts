import { describe, expect, it } from 'vitest';

import {
  errorCauseFrom,
  errorMessageFrom,
  errorNameFrom,
  errorStackFrom,
  isError,
  isErrorLike,
} from './error';

describe('isError', () => {
  it('should return true for an Error instance', () => {
    expect(isError(new Error('test'))).toBe(true);
  });

  it('should return true for subclasses of Error', () => {
    expect(isError(new TypeError('type error'))).toBe(true);
    expect(isError(new RangeError('range error'))).toBe(true);
  });

  it('should return false for null', () => {
    expect(isError(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isError(undefined)).toBe(false);
  });

  it('should return false for plain objects', () => {
    expect(isError({ message: 'test', name: 'Error' })).toBe(false);
  });

  it('should return false for strings', () => {
    expect(isError('error message')).toBe(false);
  });

  it('should return false for numbers', () => {
    expect(isError(42)).toBe(false);
  });
});

describe('isErrorLike', () => {
  it('should return true for an Error instance', () => {
    expect(isErrorLike(new Error('test'))).toBe(true);
  });

  it('should return true for a plain object with name and message strings', () => {
    expect(isErrorLike({ message: 'something went wrong', name: 'CustomError' })).toBe(true);
  });

  it('should return false for null', () => {
    expect(isErrorLike(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isErrorLike(undefined)).toBe(false);
  });

  it('should return false for a string', () => {
    expect(isErrorLike('error')).toBe(false);
  });

  it('should return false for a number', () => {
    expect(isErrorLike(404)).toBe(false);
  });

  it('should return false for object missing name', () => {
    expect(isErrorLike({ message: 'no name here' })).toBe(false);
  });

  it('should return false for object missing message', () => {
    expect(isErrorLike({ name: 'NoMessage' })).toBe(false);
  });

  it('should return false for object with non-string name', () => {
    expect(isErrorLike({ message: 'test', name: 123 })).toBe(false);
  });

  it('should return false for object with non-string message', () => {
    expect(isErrorLike({ message: 42, name: 'Error' })).toBe(false);
  });

  it('should return false for an empty object', () => {
    expect(isErrorLike({})).toBe(false);
  });
});

describe('errorNameFrom', () => {
  it('should return the name from an Error instance', () => {
    expect(errorNameFrom(new Error('test'))).toBe('Error');
  });

  it('should return the name from a subclass Error', () => {
    expect(errorNameFrom(new TypeError('type error'))).toBe('TypeError');
  });

  it('should return the name from an error-like object', () => {
    expect(errorNameFrom({ message: 'test', name: 'CustomError' })).toBe('CustomError');
  });

  it('should return undefined for null', () => {
    expect(errorNameFrom(null)).toBeUndefined();
  });

  it('should return undefined for undefined', () => {
    expect(errorNameFrom(undefined)).toBeUndefined();
  });

  it('should return undefined for a plain string', () => {
    expect(errorNameFrom('some error string')).toBeUndefined();
  });

  it('should return undefined for a non-error object', () => {
    expect(errorNameFrom({ code: 404 })).toBeUndefined();
  });
});

describe('errorMessageFrom', () => {
  it('should return the message from an Error instance', () => {
    expect(errorMessageFrom(new Error('hello world'))).toBe('hello world');
  });

  it('should return the message from an error-like object', () => {
    expect(errorMessageFrom({ message: 'custom message', name: 'Err' })).toBe('custom message');
  });

  it('should return undefined for null', () => {
    expect(errorMessageFrom(null)).toBeUndefined();
  });

  it('should return undefined for undefined', () => {
    expect(errorMessageFrom(undefined)).toBeUndefined();
  });

  it('should return undefined for a number', () => {
    expect(errorMessageFrom(500)).toBeUndefined();
  });

  it('should return undefined for non-error objects', () => {
    expect(errorMessageFrom({ reason: 'unknown' })).toBeUndefined();
  });
});

describe('errorStackFrom', () => {
  it('should return the stack from an Error instance', () => {
    const err = new Error('with stack');
    const result = errorStackFrom(err);
    expect(typeof result).toBe('string');
    expect(result).toContain('Error: with stack');
  });

  it('should return a generated stack for error-like objects without stack', () => {
    const errLike = { message: 'no stack', name: 'CustomError' };
    const result = errorStackFrom(errLike);
    expect(typeof result).toBe('string');
  });

  it('should return the explicit stack from an error-like object that has one', () => {
    const errLike = { message: 'msg', name: 'Err', stack: 'Err: msg\n    at test' };
    const result = errorStackFrom(errLike);
    expect(result).toBe('Err: msg\n    at test');
  });

  it('should generate a stack for error-like with stack explicitly set to null', () => {
    // When stack is null, the ?? operator falls through to generate a new Error stack
    const errLike = { message: 'msg', name: 'Err', stack: null };
    const result = errorStackFrom(errLike);
    expect(typeof result).toBe('string');
  });

  it('should return undefined for null input', () => {
    expect(errorStackFrom(null)).toBeUndefined();
  });

  it('should return undefined for undefined input', () => {
    expect(errorStackFrom(undefined)).toBeUndefined();
  });

  it('should return undefined for non-error values', () => {
    expect(errorStackFrom('just a string')).toBeUndefined();
    expect(errorStackFrom(42)).toBeUndefined();
  });
});

describe('errorCauseFrom', () => {
  it('should return the cause from an Error with cause', () => {
    const cause = new Error('original cause');
    const err = new Error('wrapper', { cause });
    expect(errorCauseFrom(err)).toBe(cause);
  });

  it('should return the cause from an error-like object', () => {
    const cause = { code: 'ENOENT' };
    const errLike = { cause, message: 'file not found', name: 'IOError' };
    expect(errorCauseFrom(errLike)).toBe(cause);
  });

  it('should return undefined for an Error with no cause', () => {
    expect(errorCauseFrom(new Error('no cause'))).toBeUndefined();
  });

  it('should return undefined for null', () => {
    expect(errorCauseFrom(null)).toBeUndefined();
  });

  it('should return undefined for undefined', () => {
    expect(errorCauseFrom(undefined)).toBeUndefined();
  });

  it('should return undefined for error-like with cause explicitly null', () => {
    const errLike = { cause: null, message: 'test', name: 'Error' };
    expect(errorCauseFrom(errLike)).toBeUndefined();
  });

  it('should return undefined for non-error values', () => {
    expect(errorCauseFrom('some string')).toBeUndefined();
    expect(errorCauseFrom(42)).toBeUndefined();
  });
});
