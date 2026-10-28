/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DeliveryTabs from './DeliveryTabs';
import type { GoalGraphView } from './goalGraphViewModel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./Deliverables', () => ({ default: () => <div data-testid="deliverables" /> }));
vi.mock('./Findings', () => ({ default: () => <div data-testid="findings" /> }));

const graph = { artifacts: [], findings: [] } as unknown as GoalGraphView;

describe('DeliveryTabs', () => {
  it('opens on the deliverables and switches to the findings', () => {
    render(<DeliveryTabs graph={graph} onSelect={vi.fn()} />);

    expect(screen.getByTestId('deliverables')).toBeTruthy();
    expect(screen.queryByTestId('findings')).toBeNull();

    fireEvent.click(screen.getByText('goalProcess.findings.title'));

    expect(screen.getByTestId('findings')).toBeTruthy();
    expect(screen.queryByTestId('deliverables')).toBeNull();
  });
});
