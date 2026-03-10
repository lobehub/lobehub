import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createLevelSliderComponent } from '../createLevelSlider';

// Mock the store hooks - they should NOT be called in controlled mode
vi.mock('@/store/agent', () => ({
  useAgentStore: vi.fn(() => {
    throw new Error('useAgentStore should not be called in controlled mode');
  }),
}));

vi.mock('../../../hooks/useAgentId', () => ({
  useAgentId: vi.fn(() => {
    throw new Error('useAgentId should not be called in controlled mode');
  }),
}));

vi.mock('../../../hooks/useUpdateAgentConfig', () => ({
  useUpdateAgentConfig: vi.fn(() => {
    throw new Error('useUpdateAgentConfig should not be called in controlled mode');
  }),
}));

const TEST_LEVELS = ['low', 'medium', 'high'] as const;
type TestLevel = (typeof TEST_LEVELS)[number];

describe('createLevelSliderComponent', () => {
  describe('controlled mode (with value prop)', () => {
    it('should NOT call store hooks when value prop is provided', () => {
      const TestSlider = createLevelSliderComponent<TestLevel>({
        configKey: 'reasoningEffort',
        defaultValue: 'medium',
        levels: TEST_LEVELS,
      });

      // This should NOT throw - if it throws, it means store hooks were called
      expect(() => {
        render(<TestSlider value="high" />);
      }).not.toThrow();
    });

    it('should NOT call store hooks when onChange prop is provided', () => {
      const TestSlider = createLevelSliderComponent<TestLevel>({
        configKey: 'reasoningEffort',
        defaultValue: 'medium',
        levels: TEST_LEVELS,
      });

      const mockOnChange = vi.fn();

      // This should NOT throw - if it throws, it means store hooks were called
      expect(() => {
        render(<TestSlider onChange={mockOnChange} />);
      }).not.toThrow();
    });

    it('should render with the controlled value', () => {
      const TestSlider = createLevelSliderComponent<TestLevel>({
        configKey: 'reasoningEffort',
        defaultValue: 'medium',
        levels: TEST_LEVELS,
      });

      render(<TestSlider value="high" />);

      // The slider should show the marks
      expect(screen.getByText('low')).toBeInTheDocument();
      expect(screen.getByText('medium')).toBeInTheDocument();
      expect(screen.getByText('high')).toBeInTheDocument();
    });

    it('should use defaultValue when value is not provided but onChange is', () => {
      const TestSlider = createLevelSliderComponent<TestLevel>({
        configKey: 'reasoningEffort',
        defaultValue: 'medium',
        levels: TEST_LEVELS,
      });

      const mockOnChange = vi.fn();

      // Should not throw and should render
      expect(() => {
        render(<TestSlider onChange={mockOnChange} />);
      }).not.toThrow();
    });
  });

  describe('factory configuration', () => {
    it('should create slider with custom marks', () => {
      const customMarks = {
        0: 'OFF',
        1: 'Auto',
        2: 'ON',
      };

      const TestSlider = createLevelSliderComponent<TestLevel>({
        configKey: 'thinking',
        defaultValue: 'medium',
        levels: TEST_LEVELS,
        marks: customMarks,
      });

      render(<TestSlider value="medium" />);

      expect(screen.getByText('OFF')).toBeInTheDocument();
      expect(screen.getByText('Auto')).toBeInTheDocument();
      expect(screen.getByText('ON')).toBeInTheDocument();
    });

    it('should apply custom style', () => {
      const TestSlider = createLevelSliderComponent<TestLevel>({
        configKey: 'reasoningEffort',
        defaultValue: 'medium',
        levels: TEST_LEVELS,
        style: { minWidth: 300 },
      });

      const { container } = render(<TestSlider value="medium" />);

      // The outer Flexbox should have the custom style merged
      const flexbox = container.firstChild as HTMLElement;
      expect(flexbox).toHaveStyle({ minWidth: '300px' });
    });
  });
});
