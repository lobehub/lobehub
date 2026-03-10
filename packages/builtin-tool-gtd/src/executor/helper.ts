import type { BuiltinToolContext } from '@lobechat/types';

import type { TodoItem } from '../types';

/**
 * Helper to get todos from step context or fallback to plugin state
 *
 * Priority:
 * 1. ctx.stepContext.todos - Dynamic state computed from messages at step start
 * 2. ctx.pluginState.todos - Fallback for backward compatibility
 *
 * Handles both old format ({ todos: TodoItem[] }) and new format ({ todos: { items: TodoItem[] } })
 */
export const getTodosFromContext = (ctx: BuiltinToolContext): TodoItem[] => {
  // Priority 1: stepContext.todos (computed from messages at step start)
  const stepTodos = ctx.stepContext?.todos;
  if (stepTodos?.items) {
    return stepTodos.items as TodoItem[];
  }

  // Priority 2: pluginState.todos (as if there is a new todo list)
  const state = ctx.pluginState;
  if (!state) return [];

  const todos = state.todos;
  if (!todos) return [];

  // New format: { todos: { items: TodoItem[] } }
  if (typeof todos === 'object' && 'items' in (todos as Record<string, unknown>)) {
    const items = (todos as Record<string, unknown>).items;
    return Array.isArray(items) ? (items as TodoItem[]) : [];
  }

  // Old format: { todos: TodoItem[] }
  if (Array.isArray(todos)) {
    return todos as TodoItem[];
  }

  return [];
};
