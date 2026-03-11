import { describe, expect, it, vi } from 'vitest';

import { formatCost, formatNumber, printBoxTable } from './format';

describe('formatNumber', () => {
  it('should format numbers with commas', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber(1_234_567)).toBe('1,234,567');
  });
});

describe('formatCost', () => {
  it('should format cost with dollar sign', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(1.5)).toBe('$1.50');
    expect(formatCost(123.456)).toBe('$123.46');
  });
});

describe('printBoxTable', () => {
  it('should render a basic table', () => {
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      output.push(args.join(' '));
    });

    const columns = [
      { align: 'left' as const, header: 'Name', key: 'name' },
      { align: 'right' as const, header: 'Count', key: 'count' },
    ];

    const rows = [
      { count: '100', name: 'Alice' },
      { count: '2,345', name: 'Bob' },
    ];

    printBoxTable(columns, rows);
    expect(output.join('\n')).toMatchSnapshot();

    vi.restoreAllMocks();
  });

  it('should render a table with title and multi-line cells', () => {
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      output.push(args.join(' '));
    });

    const columns = [
      { align: 'left' as const, header: 'Date', key: 'date' },
      { align: 'left' as const, header: 'Models', key: 'models' },
      { align: 'right' as const, header: ['Total', 'Tokens'], key: 'total' },
      { align: 'right' as const, header: ['Cost', '(USD)'], key: 'cost' },
    ];

    const rows = [
      {
        cost: '$1.23',
        date: '2026-03-01',
        models: ['- claude-opus-4-6', '- gpt-4o'],
        total: '19,134',
      },
      {
        cost: '$0.45',
        date: '2026-03-02',
        models: ['- claude-opus-4-6'],
        total: '5,678',
      },
    ];

    printBoxTable(columns, rows, 'Test Report');
    expect(output.join('\n')).toMatchSnapshot();

    vi.restoreAllMocks();
  });

  it('should render the usage table format', () => {
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      output.push(args.join(' '));
    });

    const columns = [
      { align: 'left' as const, header: 'Date', key: 'date' },
      { align: 'left' as const, header: 'Models', key: 'models' },
      { align: 'right' as const, header: 'Input', key: 'input' },
      { align: 'right' as const, header: 'Output', key: 'output' },
      { align: 'right' as const, header: ['Total', 'Tokens'], key: 'total' },
      { align: 'right' as const, header: 'Requests', key: 'requests' },
      { align: 'right' as const, header: ['Cost', '(USD)'], key: 'cost' },
    ];

    const rows = [
      {
        cost: '$3.56',
        date: '2026-03-01',
        input: '4,190,339',
        models: ['- claude-opus-4-6', '- gemini-3-pro-preview'],
        output: '121,035',
        requests: '69',
        total: '4,311,374',
      },
      {
        cost: '$4.75',
        date: '2026-03-02',
        input: '4,575,189',
        models: ['- claude-opus-4-6'],
        output: '34,885',
        requests: '62',
        total: '4,610,074',
      },
      {
        cost: '$8.31',
        date: 'Total',
        input: '8,765,528',
        models: '',
        output: '155,920',
        requests: '131',
        total: '8,921,448',
      },
    ];

    printBoxTable(columns, rows, 'LobeHub Token Usage Report - Monthly (2026-03)');
    expect(output.join('\n')).toMatchSnapshot();

    vi.restoreAllMocks();
  });
});
