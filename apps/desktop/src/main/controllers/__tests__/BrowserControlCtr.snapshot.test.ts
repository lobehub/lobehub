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
