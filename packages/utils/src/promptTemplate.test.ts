import { describe, expect, it } from 'vitest';

import { hydrationPrompt } from './promptTemplate';

describe('hydrationPrompt', () => {
  it('should replace basic variables', () => {
    const prompt = 'Hello {{name}}!';
    const context = { name: 'World' };
    expect(hydrationPrompt(prompt, context)).toBe('Hello World!');
  });

  it('should replace missing variables with an empty string', () => {
    const prompt = 'Hello {{name}}! Your age is {{age}}.';
    const context = { name: 'World' };
    expect(hydrationPrompt(prompt, context)).toBe('Hello World! Your age is .');
  });

  it('should replace nested variables', () => {
    const prompt = 'User: {{user.name}}, Role: {{user.role.name}}';
    const context = { user: { name: 'Alice', role: { name: 'Admin' } } };
    expect(hydrationPrompt(prompt, context)).toBe('User: Alice, Role: Admin');
  });

  it('should handle missing nested variables gracefully', () => {
    const prompt = 'User: {{user.name}}, City: {{user.address.city}}';
    const context = { user: { name: 'Bob' } };
    expect(hydrationPrompt(prompt, context)).toBe('User: Bob, City: ');
  });

  it('should handle multiple variables, some missing', () => {
    const prompt = '{{greeting}} {{user.name}}. Welcome to {{place}}. Your id is {{id}}';
    const context = { greeting: 'Hi', user: { name: 'Charlie' } };
    expect(hydrationPrompt(prompt, context)).toBe('Hi Charlie. Welcome to . Your id is ');
  });

  it('should handle empty context', () => {
    const prompt = 'Hello {{name}}!';
    const context = {};
    expect(hydrationPrompt(prompt, context)).toBe('Hello !');
  });

  it('should handle empty prompt string', () => {
    const prompt = '';
    const context = { name: 'World' };
    expect(hydrationPrompt(prompt, context)).toBe('');
  });

  it('should handle prompt with no variables', () => {
    const prompt = 'This is a plain string.';
    const context = { name: 'World' };
    expect(hydrationPrompt(prompt, context)).toBe('This is a plain string.');
  });

  it('should handle different data types in context', () => {
    const prompt = 'Count: {{count}}, Active: {{isActive}}, User: {{user}}';
    const context = { count: 123, isActive: true, user: null };
    // Note: null becomes "null" when converted to string
    expect(hydrationPrompt(prompt, context)).toBe('Count: 123, Active: true, User: null');
  });

  it('should handle keys with leading/trailing whitespace', () => {
    const prompt = 'Value: {{  spacedKey  }}';
    const context = { spacedKey: 'Trimmed' };
    expect(hydrationPrompt(prompt, context)).toBe('Value: Trimmed');
  });

  it('should replace variables with undefined value with an empty string', () => {
    const prompt = 'Name: {{name}}, Age: {{age}}';
    const context = { name: 'Defined', age: undefined };
    expect(hydrationPrompt(prompt, context)).toBe('Name: Defined, Age: ');
  });

  it('should handle complex nested structures and missing parts', () => {
    const prompt = 'Data: {{a.b.c}}, Missing: {{x.y.z}}, Partial: {{a.b.d}}';
    const context = { a: { b: { c: 'Found' } } };
    expect(hydrationPrompt(prompt, context)).toBe('Data: Found, Missing: , Partial: ');
  });
});
