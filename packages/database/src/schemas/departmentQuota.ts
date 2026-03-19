import { integer, numeric, pgTable, varchar } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';

export const departmentQuotas = pgTable('department_quotas', {
  department: varchar('department', { length: 64 }).primaryKey().notNull(),
  dailyCostLimit: numeric('daily_cost_limit', { precision: 10, scale: 6 }),
  monthlyCostLimit: numeric('monthly_cost_limit', { precision: 10, scale: 6 }),
  dailyTokenLimit: integer('daily_token_limit'),
  monthlyTokenLimit: integer('monthly_token_limit'),
  ...timestamps,
});

export type DepartmentQuotaItem = typeof departmentQuotas.$inferSelect;
export type NewDepartmentQuota = typeof departmentQuotas.$inferInsert;
