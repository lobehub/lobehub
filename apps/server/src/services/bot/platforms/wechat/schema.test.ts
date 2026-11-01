import { describe, expect, it } from 'vitest';

import type { FieldSchema } from '../types';
import { schema } from './schema';

const settingsProperties = (): FieldSchema[] =>
  schema.find((field) => field.key === 'settings')?.properties ?? [];

const field = (key: string): FieldSchema | undefined =>
  settingsProperties().find((property) => property.key === key);

describe('WeChat channel schema', () => {
  it('collects a burst by default so an image and its sentence form one turn', () => {
    // WeChat delivers "one picture + one sentence" as two webhooks a few
    // hundred ms apart. Under the plain queue the image starts its own run and
    // the sentence lands while that run still owns the topic, which is the
    // premature execution failure. `burst` waits out the window before the first
    // dispatch instead. Never `debounce`: its documented contract keeps only
    // the last message, dropping the picture.
    expect(field('concurrency')?.default).toBe('burst');
  });

  it('drops the immediate-dispatch mode and keeps labels in step with the options', () => {
    const concurrency = field('concurrency');

    // `queue` answers the picture before its sentence arrives, so WeChat does
    // not offer it. Channels created before `burst` existed still carry it in
    // their stored settings; `resolveBotConcurrency` maps that at runtime.
    expect(concurrency?.enum).toEqual(['burst', 'debounce']);
    // A label/hint list out of step with `enum` silently mislabels the picker.
    expect(concurrency?.enumLabels).toHaveLength(concurrency?.enum?.length ?? 0);
    expect(concurrency?.enumDescriptions).toHaveLength(concurrency?.enum?.length ?? 0);
    expect(concurrency?.enumLabels).toContain('channel.concurrencyBurst');
    expect(concurrency?.enumDescriptions).toContain('channel.concurrencyBurstHint');
  });

  it('shows the window size for burst as well as debounce', () => {
    // Under `burst` the window applies to every message, so it has to stay
    // editable; it used to be revealed by `debounce` alone.
    expect(field('debounceMs')?.visibleWhen).toEqual({
      field: 'concurrency',
      value: ['burst', 'debounce'],
    });
  });

  it('keeps the default window short enough to sit in front of every reply', () => {
    // The window now delays the acknowledgement of a lone message too, so the
    // old 5s value would read as an unresponsive bot.
    const debounceMs = field('debounceMs')?.default as number;

    expect(debounceMs).toBeLessThanOrEqual(2000);
    expect(debounceMs).toBeGreaterThanOrEqual(500);
  });
});
