import { describe, expect, it } from 'vitest';

import { CreateTaskRequestSchema, UpdateTaskRequestSchema } from './task.type';

/**
 * A schedule the dispatcher cannot evaluate must be refused at the boundary:
 * `TaskService.createTask` assumes the caller already validated it, so an
 * accepted-but-unusable pattern is stored and then silently never fires.
 */
describe('task schedule field schemas', () => {
  it('rejects a create whose cron the dispatcher cannot evaluate', () => {
    expect(
      CreateTaskRequestSchema.safeParse({ instruction: 'ship it', schedulePattern: 'every day' })
        .success,
    ).toBe(false);
  });

  it('accepts a create with a standard cron pattern and IANA timezone', () => {
    expect(
      CreateTaskRequestSchema.safeParse({
        automationMode: 'schedule',
        instruction: 'ship it',
        schedulePattern: '0 9 * * 1-5',
        scheduleTimezone: 'Asia/Shanghai',
      }).success,
    ).toBe(true);
  });

  it('rejects a create with an unknown timezone', () => {
    expect(
      CreateTaskRequestSchema.safeParse({ instruction: 'ship it', scheduleTimezone: 'Mars/Phobos' })
        .success,
    ).toBe(false);
  });

  it('applies the same checks to a patch', () => {
    expect(UpdateTaskRequestSchema.safeParse({ schedulePattern: 'every day' }).success).toBe(false);
    expect(UpdateTaskRequestSchema.safeParse({ scheduleTimezone: 'Mars/Phobos' }).success).toBe(
      false,
    );
    expect(UpdateTaskRequestSchema.safeParse({ schedulePattern: '0 9 * * 1-5' }).success).toBe(
      true,
    );
    expect(UpdateTaskRequestSchema.safeParse({ schedulePattern: null }).success).toBe(true);
  });
});

describe('task project field schemas', () => {
  it('accepts a project id and null on a patch, and rejects a non-string', () => {
    expect(UpdateTaskRequestSchema.parse({ projectId: 'proj_1' })).toEqual({ projectId: 'proj_1' });
    expect(UpdateTaskRequestSchema.parse({ projectId: null })).toEqual({ projectId: null });
    expect(UpdateTaskRequestSchema.safeParse({ projectId: 42 }).success).toBe(false);
  });

  it('keeps an omitted project out of a patch, so it cannot overwrite the stored one', () => {
    expect(UpdateTaskRequestSchema.parse({ name: 'x' })).not.toHaveProperty('projectId');
  });
});
