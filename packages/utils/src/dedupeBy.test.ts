import { describe, expect, it } from 'vitest';

import { dedupeBy } from './dedupeBy';

describe('dedupeBy', () => {
  it('should deduplicate items by key, keeping the first occurrence', () => {
    const items = [
      { id: '1', name: 'alice' },
      { id: '2', name: 'bob' },
      { id: '3', name: 'alice' },
    ];

    const result = dedupeBy(items, (item) => item.name);

    expect(result).toEqual([
      { id: '1', name: 'alice' },
      { id: '2', name: 'bob' },
    ]);
  });

  it('should return all items when there are no duplicates', () => {
    const items = [
      { id: '1', name: 'alice' },
      { id: '2', name: 'bob' },
    ];

    const result = dedupeBy(items, (item) => item.name);

    expect(result).toEqual(items);
  });

  it('should return empty array for empty input', () => {
    expect(dedupeBy([], (item: string) => item)).toEqual([]);
  });

  it('should deduplicate tools by function name (real-world scenario)', () => {
    const tools = [
      { function: { name: 'lobe-web-browsing____search____builtin' }, type: 'function' },
      { function: { name: 'get_weather' }, type: 'function' },
      { function: { name: 'lobe-web-browsing____search____builtin' }, type: 'function' },
    ];

    const result = dedupeBy(tools, (tool) => tool.function.name);

    expect(result).toHaveLength(2);
    expect(result[0].function.name).toBe('lobe-web-browsing____search____builtin');
    expect(result[1].function.name).toBe('get_weather');
  });
});
