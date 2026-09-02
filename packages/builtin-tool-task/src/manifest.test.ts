import { describe, expect, it } from 'vitest';

import { TaskManifest } from './manifest';
import { TaskApiName } from './types';

describe('TaskManifest Work semantics', () => {
  it('keeps goal orchestration outside the task tool scope', () => {
    const createTask = TaskManifest.api.find((api) => api.name === TaskApiName.createTask);

    expect(TaskManifest.api.some((api) => api.name === TaskApiName.createGoal)).toBe(false);
    expect(createTask?.work).toEqual({ action: 'create', resourceType: 'task' });
  });
});

describe('TaskManifest human assignee (assigneeUserId)', () => {
  const findApi = (name: string) => TaskManifest.api.find((api) => api.name === name);
  const props = (name: string) =>
    (findApi(name)?.parameters as { properties: Record<string, unknown> }).properties;

  it('accepts a workspace member id on createTask and each createTasks item', () => {
    expect(props(TaskApiName.createTask).assigneeUserId).toMatchObject({ type: 'string' });

    const items = (props(TaskApiName.createTasks).tasks as { items: { properties: any } }).items;
    expect(items.properties.assigneeUserId).toMatchObject({ type: 'string' });
  });

  it('lets editTask set or clear the member assignee', () => {
    expect(props(TaskApiName.editTask).assigneeUserId).toMatchObject({
      type: ['string', 'null'],
    });
  });

  it('exposes listWorkspaceMembers so ids are resolved instead of guessed', () => {
    const api = findApi(TaskApiName.listWorkspaceMembers);
    expect(api).toBeDefined();
    // Bounded directory: an optional narrowing query and a page cap, nothing required.
    expect(api?.parameters).toMatchObject({
      properties: { limit: { type: 'number' }, query: { type: 'string' } },
      required: [],
      type: 'object',
    });
    // The client path has no IM identities, so the contract only promises them where available.
    expect(api?.description).toContain('where available');
    // Read-only: must not register a Work entity.
    expect(api?.work).toBeUndefined();
    // The assignee params point the model at the resolver.
    expect(String((props(TaskApiName.createTask).assigneeUserId as any).description)).toContain(
      'listWorkspaceMembers',
    );
  });
});
