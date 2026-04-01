import { describe, expect, it } from 'vitest';

import { buildDepartmentQuotaRows } from './departmentQuotaRows';

describe('buildDepartmentQuotaRows', () => {
  it('should merge departments from users and quotas', () => {
    const rows = buildDepartmentQuotaRows(
      [{ interests: ['Engineering'] }, { interests: ['Sales'] }, { interests: ['Engineering'] }],
      [
        {
          dailyCostLimit: 1,
          dailyTokenLimit: 100,
          department: 'Engineering',
          monthlyCostLimit: 10,
          monthlyTokenLimit: 1000,
        },
        {
          dailyCostLimit: 2,
          dailyTokenLimit: 200,
          department: 'Finance',
          monthlyCostLimit: 20,
          monthlyTokenLimit: 2000,
        },
      ],
    );

    expect(rows).toEqual([
      {
        dailyCostLimit: 1,
        dailyTokenLimit: 100,
        department: 'Engineering',
        monthlyCostLimit: 10,
        monthlyTokenLimit: 1000,
      },
      {
        dailyCostLimit: 2,
        dailyTokenLimit: 200,
        department: 'Finance',
        monthlyCostLimit: 20,
        monthlyTokenLimit: 2000,
      },
      {
        dailyCostLimit: null,
        dailyTokenLimit: null,
        department: 'Sales',
        monthlyCostLimit: null,
        monthlyTokenLimit: null,
      },
    ]);
  });

  it('should place users without department into 其他', () => {
    const rows = buildDepartmentQuotaRows(
      [{ interests: [] }, { interests: undefined }, { interests: ['  '] }],
      [],
    );

    expect(rows).toEqual([
      {
        dailyCostLimit: null,
        dailyTokenLimit: null,
        department: '其他',
        monthlyCostLimit: null,
        monthlyTokenLimit: null,
      },
    ]);
  });
});
