import { describe, expect, it } from 'vitest';

import { BuiltinSystemRolePrompts } from './index';

describe('BuiltinSystemRolePrompts', () => {
  it('should return welcome message only when only welcome is provided', () => {
    const result = BuiltinSystemRolePrompts({
      welcome: 'Welcome to the assistant!',
    });

    expect(result).toBe('Welcome to the assistant!');
  });

  it('should return plugins message only when only plugins is provided', () => {
    const result = BuiltinSystemRolePrompts({
      plugins: 'Available plugins: calculator, weather',
    });

    expect(result).toBe('Available plugins: calculator, weather');
  });

  it('should return history summary when only history is provided', () => {
    const result = BuiltinSystemRolePrompts({
      historySummary: 'User discussed AI topics previously',
    });

    expect(result).toContain('<chat_history_summary>');
    expect(result).toContain(
      '<docstring>Users may have lots of chat messages, here is the summary of the history:</docstring>',
    );
    expect(result).toContain('<summary>User discussed AI topics previously</summary>');
    expect(result).toContain('</chat_history_summary>');
    expect(result.trim()).toMatch(/^<chat_history_summary>[\s\S]*<\/chat_history_summary>$/);
  });

  it('should combine all three parts when all are provided', () => {
    const result = BuiltinSystemRolePrompts({
      welcome: 'Welcome!',
      plugins: 'Plugins available',
      historySummary: 'Previous conversation summary',
    });

    expect(result).toContain('Welcome!');
    expect(result).toContain('Plugins available');
    expect(result).toContain('<chat_history_summary>');
    expect(result).toContain('Previous conversation summary');
    expect(result).toContain('</chat_history_summary>');

    // Should be joined with double newlines
    const parts = result.split('\n\n');
    expect(parts).toHaveLength(3);
  });

  it('should combine welcome and plugins when no history is provided', () => {
    const result = BuiltinSystemRolePrompts({
      welcome: 'Hello user!',
      plugins: 'Available tools',
    });

    expect(result).toBe('Hello user!\n\nAvailable tools');
  });

  it('should combine welcome and history when no plugins provided', () => {
    const result = BuiltinSystemRolePrompts({
      welcome: 'Greetings!',
      historySummary: 'Chat history here',
    });

    expect(result).toContain('Greetings!');
    expect(result).toContain('<chat_history_summary>');
    expect(result).toContain('Chat history here');
  });

  it('should combine plugins and history when no welcome provided', () => {
    const result = BuiltinSystemRolePrompts({
      plugins: 'Tool list',
      historySummary: 'Summary of previous chats',
    });

    expect(result).toContain('Tool list');
    expect(result).toContain('<chat_history_summary>');
    expect(result).toContain('Summary of previous chats');
  });

  it('should return empty string when no parameters provided', () => {
    const result = BuiltinSystemRolePrompts({});

    expect(result).toBe('');
  });

  it('should filter out falsy values', () => {
    const result = BuiltinSystemRolePrompts({
      welcome: '',
      plugins: 'Valid plugins',
      historySummary: undefined,
    });

    expect(result).toBe('Valid plugins');
  });

  it('should handle null and undefined values gracefully', () => {
    const result = BuiltinSystemRolePrompts({
      welcome: undefined,
      plugins: null as any,
      historySummary: 'Valid history',
    });

    expect(result).toContain('<chat_history_summary>');
    expect(result).toContain('<summary>Valid history</summary>');
    expect(result).toContain('</chat_history_summary>');
  });

  it('should preserve whitespace in individual components', () => {
    const result = BuiltinSystemRolePrompts({
      welcome: 'Welcome\nwith newlines',
      plugins: 'Plugins\twith tabs',
    });

    expect(result).toContain('Welcome\nwith newlines');
    expect(result).toContain('Plugins\twith tabs');
  });

  it('should format history summary with proper XML structure', () => {
    const historySummary = 'User asked about weather and traffic';
    const result = BuiltinSystemRolePrompts({
      historySummary,
    });

    expect(result).toContain('<chat_history_summary>');
    expect(result).toContain(
      '<docstring>Users may have lots of chat messages, here is the summary of the history:</docstring>',
    );
    expect(result).toContain('<summary>User asked about weather and traffic</summary>');
    expect(result).toContain('</chat_history_summary>');
  });
});
