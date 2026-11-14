import { afterEach, describe, expect, it } from 'vitest';

import { isRowOwnClick, resolveFolderRowClick } from './rowClick';

const buildRow = () => {
  const row = document.createElement('div');
  row.innerHTML = `
    <div class="caret"></div>
    <span class="name">Folder <b class="name-inner">A</b></span>
    <div class="hierarchy-node-actions"><button class="more"><svg class="more-icon"></svg></button></div>
  `;
  document.body.append(row);
  return row;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isRowOwnClick', () => {
  it('accepts clicks on the row and on its name', () => {
    const row = buildRow();

    expect(isRowOwnClick({ currentTarget: row, target: row })).toBe(true);
    expect(isRowOwnClick({ currentTarget: row, target: row.querySelector('.name') })).toBe(true);
    expect(isRowOwnClick({ currentTarget: row, target: row.querySelector('.name-inner') })).toBe(
      true,
    );
  });

  it('accepts a click on the name text node', () => {
    const row = buildRow();
    const text = row.querySelector('.name')!.firstChild;

    expect(isRowOwnClick({ currentTarget: row, target: text })).toBe(true);
  });

  it('rejects clicks on the row actions ("+" / "...")', () => {
    const row = buildRow();

    expect(isRowOwnClick({ currentTarget: row, target: row.querySelector('.more') })).toBe(false);
    expect(isRowOwnClick({ currentTarget: row, target: row.querySelector('.more-icon') })).toBe(
      false,
    );
  });

  it('rejects clicks React bubbles up from a portal outside the row', () => {
    const row = buildRow();
    const menuItem = document.createElement('div');
    document.body.append(menuItem);

    expect(isRowOwnClick({ currentTarget: row, target: menuItem })).toBe(false);
    expect(isRowOwnClick({ currentTarget: row, target: null })).toBe(false);
  });
});

describe('resolveFolderRowClick', () => {
  it('toggles the active folder instead of re-navigating into it', () => {
    const row = buildRow();
    const name = row.querySelector('.name');

    expect(resolveFolderRowClick({ currentTarget: row, target: name }, { isActive: true })).toBe(
      'toggle',
    );
  });

  it('navigates into a folder that is not active', () => {
    const row = buildRow();
    const name = row.querySelector('.name');

    expect(resolveFolderRowClick({ currentTarget: row, target: name }, { isActive: false })).toBe(
      'navigate',
    );
  });

  it('always navigates from a flat search-result row, which has no caret', () => {
    const row = buildRow();
    const name = row.querySelector('.name');

    expect(
      resolveFolderRowClick({ currentTarget: row, target: name }, { flat: true, isActive: true }),
    ).toBe('navigate');
  });

  it('ignores clicks on the row actions and from portaled menus', () => {
    const row = buildRow();
    const menuItem = document.createElement('div');
    document.body.append(menuItem);

    expect(
      resolveFolderRowClick(
        { currentTarget: row, target: row.querySelector('.more') },
        { isActive: true },
      ),
    ).toBe('ignore');
    expect(
      resolveFolderRowClick({ currentTarget: row, target: menuItem }, { isActive: false }),
    ).toBe('ignore');
  });
});
