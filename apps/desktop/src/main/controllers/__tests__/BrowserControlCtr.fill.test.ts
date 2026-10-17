/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';

import { fillScript } from '../BrowserControlCtr';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

const fillSelect = (text: string) => {
  document.body.innerHTML = `
    <select aria-label="Card type">
      <option value="attack">Attack</option>
      <option value="skill">Skill</option>
      <option value="power">Power   Card</option>
    </select>`;
  const select = document.querySelector('select')!;
  const changes: string[] = [];
  select.addEventListener('change', () => changes.push(select.value));
  (window as any).__lobeBrowserRefs = { e1: select };

  const result = JSON.parse((0, eval)(fillScript('e1', text)));
  return { changes, result, value: select.value };
};

describe('fillScript on a native select', () => {
  it('chooses the option by its visible label and fires change', () => {
    expect(fillSelect('Skill')).toEqual({
      changes: ['skill'],
      result: { ok: true },
      value: 'skill',
    });
  });

  it('chooses the option by value, and matches labels ignoring case and spacing', () => {
    expect(fillSelect('power').value).toBe('power');
    expect(fillSelect('power card').value).toBe('power');
  });

  it('selects the matched option itself when option values repeat', () => {
    document.body.innerHTML = `
      <select aria-label="Owner">
        <option value="">Choose…</option>
        <option value="">None</option>
        <option value="ann">Ann</option>
      </select>`;
    const select = document.querySelector('select')!;
    (window as any).__lobeBrowserRefs = { e1: select };

    expect(JSON.parse((0, eval)(fillScript('e1', 'None')))).toEqual({ ok: true });

    expect(select.selectedIndex).toBe(1);
  });

  it('matches the rendered label of an option with a label attribute', () => {
    document.body.innerHTML = `
      <select aria-label="Language">
        <option value="zh" label="Chinese">中文（简体）</option>
        <option value="en" label="English">English (US)</option>
      </select>`;
    const select = document.querySelector('select')!;
    (window as any).__lobeBrowserRefs = { e1: select };

    expect(JSON.parse((0, eval)(fillScript('e1', 'English')))).toEqual({ ok: true });
    expect(select.value).toBe('en');
    expect(JSON.parse((0, eval)(fillScript('e1', 'French'))).error).toBe(
      'no option matches "French"; options: Chinese, English',
    );
  });

  it('lists the available options when nothing matches', () => {
    const { result, value } = fillSelect('Curse');

    expect(value).toBe('attack');
    expect(result.error).toBe('no option matches "Curse"; options: Attack, Skill, Power   Card');
  });
});
