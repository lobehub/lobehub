/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RowMouseSensor, RowTouchSensor } from '@/features/HomeSidebar/Body/sortableRow';

import { FolderCardActions } from './Actions';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('FolderCardActions', () => {
  it('does not arm the card drag sensors when the ⋯ button is pressed', () => {
    render(<FolderCardActions menuItems={[]} />);
    const button = screen.getByRole('button', { name: 'list.moreActions' });

    const mouse = new MouseEvent('mousedown', { bubbles: true, button: 0 });
    Object.defineProperty(mouse, 'target', { value: button });
    const touch = new Event('touchstart', { bubbles: true });
    Object.defineProperty(touch, 'target', { value: button });

    expect(RowMouseSensor.activators[0].handler({ nativeEvent: mouse })).toBe(false);
    expect(RowTouchSensor.activators[0].handler({ nativeEvent: touch as TouchEvent })).toBe(false);
  });
});
