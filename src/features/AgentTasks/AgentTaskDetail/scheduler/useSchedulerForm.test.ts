import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSchedulerForm } from './useSchedulerForm';

describe('useSchedulerForm', () => {
  it('preserves qualified cron patterns when editing timezone or max executions', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useSchedulerForm({
        maxExecutions: null,
        onChange,
        pattern: '30 9 * * FRI#2',
        timezone: 'UTC',
      }),
    );

    act(() => {
      result.current.handleTimezoneChange('Asia/Shanghai');
    });

    expect(onChange).toHaveBeenLastCalledWith({
      maxExecutions: null,
      pattern: '30 9 * * FRI#2',
      timezone: 'Asia/Shanghai',
    });

    act(() => {
      result.current.handleContinuousChange(false);
    });

    expect(onChange).toHaveBeenLastCalledWith({
      maxExecutions: 100,
      pattern: '30 9 * * FRI#2',
      timezone: 'Asia/Shanghai',
    });

    act(() => {
      result.current.handleMaxExecChange(5);
    });

    expect(onChange).toHaveBeenLastCalledWith({
      maxExecutions: 5,
      pattern: '30 9 * * FRI#2',
      timezone: 'Asia/Shanghai',
    });
  });

  it('preserves qualified weekdays when changing only hour or minute', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useSchedulerForm({
        maxExecutions: null,
        onChange,
        pattern: '30 9 * * FRI#2',
        timezone: 'UTC',
      }),
    );

    act(() => {
      result.current.handleHourChange(10);
    });

    expect(onChange).toHaveBeenLastCalledWith({
      maxExecutions: null,
      pattern: '30 10 * * FRI#2',
      timezone: 'UTC',
    });

    act(() => {
      result.current.handleMinuteChange(0);
    });

    expect(onChange).toHaveBeenLastCalledWith({
      maxExecutions: null,
      pattern: '0 10 * * FRI#2',
      timezone: 'UTC',
    });

    act(() => {
      result.current.handleTimezoneChange('America/New_York');
    });

    expect(onChange).toHaveBeenLastCalledWith({
      maxExecutions: null,
      pattern: '0 10 * * FRI#2',
      timezone: 'America/New_York',
    });
  });

  it('replaces a qualified weekday only when the user picks weekdays or changes frequency', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useSchedulerForm({
        maxExecutions: null,
        onChange,
        pattern: '30 9 * * 5L',
        timezone: 'UTC',
      }),
    );

    act(() => {
      result.current.handleScheduleTypeChange('weekly');
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      result.current.handleWeekdaysChange(['1']);
    });

    expect(onChange).toHaveBeenLastCalledWith({
      maxExecutions: null,
      pattern: '30 9 * * 1',
      timezone: 'UTC',
    });

    act(() => {
      result.current.handleScheduleTypeChange('daily');
    });

    expect(onChange).toHaveBeenLastCalledWith({
      maxExecutions: null,
      pattern: '30 9 * * *',
      timezone: 'UTC',
    });
  });
});
