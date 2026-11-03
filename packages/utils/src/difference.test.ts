import { describe, expect, it } from 'vitest';

import { difference } from './difference';

// 假设 difference 函数在这个路径下

describe('difference function', () => {
  it('should return an empty object if both objects are equal', () => {
    const objA = { a: 1, b: 2 };
    const objB = { a: 1, b: 2 };
    expect(difference(objA, objB)).toEqual({});
  });

  it('should return the differences between two objects', () => {
    const objA = { a: 1, b: 2 };
    const objB = { a: 2, b: 2 };
    expect(difference(objA, objB)).toEqual({ a: 1 });
  });

  it('should handle nested objects', () => {
    const objA = { a: 1, b: { c: 3, d: 4 } };
    const objB = { a: 1, b: { c: 3, d: 5 } };
    expect(difference(objA, objB)).toEqual({ b: { d: 4 } });
  });

  it('should handle arrays as different objects', () => {
    const objA = { a: [1, 2, 3] };
    const objB = { a: [1, 2, 4] };
    expect(difference(objA, objB)).toEqual({ a: [1, 2, 3] });
  });

  it('should handle different types between values', () => {
    const objA = { a: 1, b: '2' };
    const objB = { a: '1', b: 2 };
    expect(difference(objA, objB as any)).toEqual({ a: 1, b: '2' });
  });

  it('should not consider prototype properties', () => {
    const objA = Object.create({ inherited: true });
    objA.own = 1;
    const objB = { own: 1 };
    expect(difference(objA, objB)).toEqual({});
  });

  // 更多的测试用例可以根据需要添加
});
