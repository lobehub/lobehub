import { integer, pgTable, varchar } from 'drizzle-orm/pg-core';

import { amountNumeric, createdAt, updatedAt } from './_helpers';

export const departmentQuotas = pgTable('department_quotas', {
  department: varchar('department', { length: 64 }).primaryKey().notNull(),
  dailyCostLimit: amountNumeric('daily_cost_limit'),
  monthlyCostLimit: amountNumeric('monthly_cost_limit'),
  dailyTokenLimit: integer('daily_token_limit'),
  monthlyTokenLimit: integer('monthly_token_limit'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type DepartmentQuotaItem = typeof departmentQuotas.$inferSelect;
export type NewDepartmentQuota = typeof departmentQuotas.$inferInsert;
