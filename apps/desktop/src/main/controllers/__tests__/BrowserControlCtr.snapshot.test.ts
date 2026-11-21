/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SNAPSHOT_SCRIPT } from '../BrowserControlCtr';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

const snapshotOf = (html: string): string => {
  document.body.innerHTML = html;

  return JSON.parse((0, eval)(SNAPSHOT_SCRIPT)).snapshot;
};

describe('SNAPSHOT_SCRIPT visibility', () => {
  beforeEach(() => {
    // happy-dom does no layout; give every element a real box.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 30,
      height: 30,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
    } as DOMRect);
  });

  it('leaves out a closed dialog kept in the DOM under a transparent wrapper', () => {
    const snapshot = snapshotOf(`
      <button>Add album</button>
      <div class="modal" style="opacity: 0">
        <div role="dialog" aria-label="Enter admin password">
          <input placeholder="Password" />
          <button>Verify and continue</button>
        </div>
      </div>
    `);

    expect(snapshot).toContain('button "Add album"');
    expect(snapshot).not.toContain('Enter admin password');
    expect(snapshot).not.toContain('Verify and continue');
  });

  it('leaves out aria-hidden and inert subtrees', () => {
    const snapshot = snapshotOf(`
      <div aria-hidden="true"><button>Hidden by aria</button></div>
      <div inert><button>Hidden by inert</button></div>
      <button>Visible</button>
    `);

    expect(snapshot).toBe('- button "Visible" [ref=e1]');
  });

  it('keeps a transparent native checkbox styled by its label', () => {
    const snapshot = snapshotOf(`
      <label><input type="checkbox" aria-label="Remember me" style="opacity: 0" /> Remember me</label>
    `);

    expect(snapshot).toContain('checkbox "Remember me"');
  });

  it('lists the dialog once it is shown', () => {
    const snapshot = snapshotOf(`
      <div class="modal" style="opacity: 1">
        <div role="dialog" aria-label="Enter admin password"><button>Verify and continue</button></div>
      </div>
    `);

    expect(snapshot).toContain('dialog "Enter admin password');
    expect(snapshot).toContain('button "Verify and continue"');
  });
});

describe('SNAPSHOT_SCRIPT file inputs', () => {
  const box = (width: number, height: number) =>
    ({ bottom: height, height, left: 0, right: width, top: 0, width, x: 0, y: 0 }) as DOMRect;

  beforeEach(() => {
    // happy-dom does no layout: a display:none input gets no box, the rest do.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return (this as HTMLElement).style?.display === 'none' || this.hasAttribute('hidden')
        ? box(0, 0)
        : box(100, 30);
    });
  });

  // A typical upload widget: the input is display:none behind a styled button,
  // so the snapshot showed the button only and the agent had nothing to upload to.
  it('lists a hidden file input with what it accepts, named by its widget', () => {
    const snapshot = snapshotOf(`
      <span class="ant-upload"><input type="file" accept=".zip" style="display: none" /><button>Click to upload ZIP</button></span>
      <div><input type="file" multiple hidden aria-label="Add images" /></div>
    `);

    expect(snapshot.split('\n')).toEqual([
      '- file-input "Click to upload ZIP" [ref=e1] [accept=".zip"] [hidden]',
      '- button "Click to upload ZIP" [ref=e2]',
      '- file-input "Add images" [ref=e3] [multiple] [hidden]',
    ]);
  });

  it('leaves out a file input inside a closed dialog', () => {
    const snapshot = snapshotOf(`
      <div style="opacity: 0"><input type="file" aria-label="Old upload" /></div>
      <div aria-hidden="true"><input type="file" aria-label="Hidden upload" /></div>
    `);

    expect(snapshot).toBe('');
  });

  it('still lists file inputs past the element cap', () => {
    const buttons = Array.from({ length: 260 }, (_, i) => `<button>b${i}</button>`).join('');
    const snapshot = snapshotOf(`${buttons}<input type="file" aria-label="Late upload" />`);
    const lines = snapshot.split('\n');

    expect(lines).toHaveLength(251);
    expect(lines.at(-1)).toBe('- file-input "Late upload" [ref=e251]');
  });
});
