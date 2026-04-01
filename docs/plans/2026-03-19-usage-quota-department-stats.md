# Usage Quota & Department Stats Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-user and per-department daily/monthly cost+token quotas, admin UI to manage them, and enforce limits on AI requests with informative error messages.

**Architecture:** Add quota fields to `users` table + new `department_quotas` table. Quota check runs in `aiChat.sendMessageInServer` before dispatching to AI. Admin stats page gains per-user and per-department views with inline quota editing.

**Tech Stack:** Drizzle ORM (PostgreSQL), TRPC, React + @lobehub/ui, react-i18next, SWR

---

## Task 1: Database Schema — Add quota fields to users table

**Files:**

- Modify: `packages/database/src/schemas/user.ts`

**Step 1: Add 4 quota columns to the users table**

In `packages/database/src/schemas/user.ts`, after the `interests` field (line 22), add:

```ts
dailyCostLimit: numeric('daily_cost_limit', { precision: 10, scale: 6 }),
monthlyCostLimit: numeric('monthly_cost_limit', { precision: 10, scale: 6 }),
dailyTokenLimit: integer('daily_token_limit'),
monthlyTokenLimit: integer('monthly_token_limit'),
```

Import `numeric` and `integer` from `drizzle-orm/pg-core` (already has `varchar`, `text`, etc — add to existing import).

**Step 2: Commit**

```bash
git add packages/database/src/schemas/user.ts
git commit -m "feat(db): add quota limit fields to users table"
```

---

## Task 2: Database Schema — New department_quotas table

**Files:**

- Create: `packages/database/src/schemas/departmentQuota.ts`
- Modify: `packages/database/src/schemas/index.ts`

**Step 1: Create the schema file**

```ts
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
```

**Step 2: Export from index**

Add to `packages/database/src/schemas/index.ts`:

```ts
export * from './departmentQuota';
```

**Step 3: Commit**

```bash
git add packages/database/src/schemas/departmentQuota.ts packages/database/src/schemas/index.ts
git commit -m "feat(db): add department_quotas table schema"
```

---

## Task 3: Generate and run migration

**Step 1: Generate migration**

```bash
bun run db:generate
```

Expected: creates `packages/database/migrations/0093_usage_quotas.sql` with ALTER TABLE and CREATE TABLE statements.

**Step 2: Run migration**

```bash
bun run db:migrate
```

Expected: migration applied successfully.

**Step 3: Commit**

```bash
git add packages/database/migrations/
git commit -m "feat(db): migration 0093 — usage quota fields and department_quotas table"
```

---

## Task 4: Quota check service method

**Files:**

- Modify: `src/server/services/usage/index.ts`

**Step 1: Add QuotaCheckResult type at top of file**

```ts
export interface QuotaCheckResult {
  status: 'ok' | 'warning' | 'exceeded';
  todayCost: number;
  todayTokens: number;
  monthlyCost: number;
  monthlyTokens: number;
  effectiveDailyCostLimit: number | null;
  effectiveDailyTokenLimit: number | null;
  effectiveMonthlyCostLimit: number | null;
  effectiveMonthlyTokenLimit: number | null;
}
```

**Step 2: Add `checkQuota` method to `UsageRecordService`**

Add after the existing `findAndGroupByDateRange` method:

```ts
checkQuota = async (): Promise<QuotaCheckResult> => {
  const today = dayjs().format('YYYY-MM-DD');
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD');
  const monthEnd = dayjs().endOf('month').format('YYYY-MM-DD');

  // 1. Fetch user limits + department
  const user = await this.db.query.users.findFirst({
    columns: {
      dailyCostLimit: true,
      dailyTokenLimit: true,
      interests: true,
      monthlyCostLimit: true,
      monthlyTokenLimit: true,
    },
    where: eq(users.id, this.userId),
  });

  // 2. Fetch department limits
  const department = user?.interests?.[0];
  let deptQuota = null;
  if (department) {
    deptQuota = await this.db.query.departmentQuotas.findFirst({
      where: eq(departmentQuotas.department, department),
    });
  }

  // 3. Effective limit = min(user, dept), null means no limit
  const minLimit = (a: string | null | undefined, b: string | null | undefined) => {
    const na = a ? parseFloat(a) : null;
    const nb = b ? parseFloat(b) : null;
    if (na === null && nb === null) return null;
    if (na === null) return nb;
    if (nb === null) return na;
    return Math.min(na, nb);
  };
  const minIntLimit = (a: number | null | undefined, b: number | null | undefined) => {
    if (a == null && b == null) return null;
    if (a == null) return b;
    if (b == null) return a;
    return Math.min(a, b);
  };

  const effectiveDailyCostLimit = minLimit(user?.dailyCostLimit, deptQuota?.dailyCostLimit);
  const effectiveMonthlyCostLimit = minLimit(user?.monthlyCostLimit, deptQuota?.monthlyCostLimit);
  const effectiveDailyTokenLimit = minIntLimit(user?.dailyTokenLimit, deptQuota?.dailyTokenLimit);
  const effectiveMonthlyTokenLimit = minIntLimit(
    user?.monthlyTokenLimit,
    deptQuota?.monthlyTokenLimit,
  );

  // 4. Query today's and this month's usage
  const todayRecords = await this.findByDateRange(today, today);
  const monthRecords = await this.findByDateRange(monthStart, monthEnd);

  const todayCost = todayRecords.reduce((s, r) => s + r.spend, 0);
  const todayTokens = todayRecords.reduce((s, r) => s + (r.totalTokens || 0), 0);
  const monthlyCost = monthRecords.reduce((s, r) => s + r.spend, 0);
  const monthlyTokens = monthRecords.reduce((s, r) => s + (r.totalTokens || 0), 0);

  // 5. Determine status (worst across all dimensions)
  const ratio = (used: number, limit: number | null) => (limit ? used / limit : 0);
  const maxRatio = Math.max(
    ratio(todayCost, effectiveDailyCostLimit),
    ratio(todayTokens, effectiveDailyTokenLimit),
    ratio(monthlyCost, effectiveMonthlyCostLimit),
    ratio(monthlyTokens, effectiveMonthlyTokenLimit),
  );

  const status = maxRatio >= 1 ? 'exceeded' : maxRatio >= 0.8 ? 'warning' : 'ok';

  return {
    effectiveDailyCostLimit,
    effectiveDailyTokenLimit,
    effectiveMonthlyCostLimit,
    effectiveMonthlyTokenLimit,
    monthlyCost,
    monthlyTokens,
    status,
    todayCost,
    todayTokens,
  };
};
```

Add imports at top: `import { departmentQuotas, users } from '@/database/schemas';`

**Step 3: Commit**

```bash
git add src/server/services/usage/index.ts
git commit -m "feat(usage): add checkQuota method to UsageRecordService"
```

---

## Task 5: TRPC — quota check + admin quota management endpoints

**Files:**

- Modify: `src/server/routers/lambda/usage.ts`

**Step 1: Add `checkQuota` endpoint (authed user)**

Add to `usageRouter`:

```ts
checkQuota: usageProcedure.query(async ({ ctx }) => {
  return await ctx.usageRecordService.checkQuota();
}),
```

**Step 2: Add admin quota endpoints**

Add to `usageRouter`:

```ts
adminSetUserQuota: adminUsageProcedure
  .input(z.object({
    dailyCostLimit: z.string().nullable(),
    dailyTokenLimit: z.number().int().nullable(),
    monthlyCostLimit: z.string().nullable(),
    monthlyTokenLimit: z.number().int().nullable(),
    userId: z.string(),
  }))
  .mutation(async ({ ctx, input }) => {
    const { userId, ...limits } = input;
    await ctx.serverDB
      .update(users)
      .set(limits)
      .where(eq(users.id, userId));
  }),

adminSetDepartmentQuota: adminUsageProcedure
  .input(z.object({
    dailyCostLimit: z.string().nullable(),
    dailyTokenLimit: z.number().int().nullable(),
    department: z.string(),
    monthlyCostLimit: z.string().nullable(),
    monthlyTokenLimit: z.number().int().nullable(),
  }))
  .mutation(async ({ ctx, input }) => {
    const { department, ...limits } = input;
    await ctx.serverDB
      .insert(departmentQuotas)
      .values({ department, ...limits })
      .onConflictDoUpdate({ set: limits, target: departmentQuotas.department });
  }),

adminGetAllUserQuotas: adminUsageProcedure.query(async ({ ctx }) => {
  return await ctx.serverDB.query.users.findMany({
    columns: {
      dailyCostLimit: true,
      dailyTokenLimit: true,
      email: true,
      fullName: true,
      id: true,
      interests: true,
      monthlyCostLimit: true,
      monthlyTokenLimit: true,
    },
  });
}),

adminGetAllDepartmentQuotas: adminUsageProcedure.query(async ({ ctx }) => {
  return await ctx.serverDB.query.departmentQuotas.findMany();
}),

adminGetUsageByDepartment: adminUsageProcedure
  .input(z.object({ mo: z.string().optional() }))
  .query(async ({ ctx, input }) => {
    return await ctx.usageRecordService.findAllByDepartment(input.mo);
  }),
```

Add imports: `import { departmentQuotas, users } from '@/database/schemas';`

**Step 3: Commit**

```bash
git add src/server/routers/lambda/usage.ts
git commit -m "feat(trpc): add quota check and admin quota management endpoints"
```

---

## Task 6: Usage service — findAllByDepartment

**Files:**

- Modify: `src/server/services/usage/index.ts`

**Step 1: Add `findAllByDepartment` method**

```ts
findAllByDepartment = async (
  mo?: string,
): Promise<
  { department: string; totalSpend: number; totalTokens: number; totalRequests: number }[]
> => {
  const records = await this.findAllByMonth(mo);

  // Join with users to get department (interests[0])
  const userDepts = await this.db.query.users.findMany({
    columns: { id: true, interests: true },
  });
  const deptMap = new Map(userDepts.map((u) => [u.id, u.interests?.[0] ?? '其他']));

  const grouped = new Map<
    string,
    { totalSpend: number; totalTokens: number; totalRequests: number }
  >();
  for (const r of records) {
    const dept = deptMap.get(r.userId ?? '') ?? '其他';
    const existing = grouped.get(dept) ?? { totalRequests: 0, totalSpend: 0, totalTokens: 0 };
    grouped.set(dept, {
      totalRequests: existing.totalRequests + 1,
      totalSpend: existing.totalSpend + r.spend,
      totalTokens: existing.totalTokens + (r.totalTokens || 0),
    });
  }

  return Array.from(grouped.entries()).map(([department, stats]) => ({ department, ...stats }));
};
```

**Step 2: Commit**

```bash
git add src/server/services/usage/index.ts
git commit -m "feat(usage): add findAllByDepartment aggregation method"
```

---

## Task 7: Enforce quota in aiChat router

**Files:**

- Modify: `src/server/routers/lambda/aiChat.ts`

**Step 1: Add quota check at start of `sendMessageInServer`**

After line 66 (`let sessionId = input.sessionId;`), add:

```ts
// Check quota before dispatching AI request
const usageService = new UsageRecordService(ctx.serverDB, ctx.userId);
const quota = await usageService.checkQuota();
if (quota.status === 'exceeded') {
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: JSON.stringify({
      effectiveDailyCostLimit: quota.effectiveDailyCostLimit,
      reason: 'quota_exceeded',
      todayCost: quota.todayCost,
    }),
  });
}
```

Add imports:

```ts
import { TRPCError } from '@trpc/server';
import { UsageRecordService } from '@/server/services/usage';
```

**Step 2: Commit**

```bash
git add src/server/routers/lambda/aiChat.ts
git commit -m "feat(chat): enforce quota before AI request dispatch"
```

---

## Task 8: Client service — add quota methods

**Files:**

- Modify: `src/services/usage.ts`

**Step 1: Read current file, then add methods**

Add to the `UsageService` class:

```ts
checkQuota = () => this.client.usage.checkQuota.query();

adminGetAllUserQuotas = () => this.client.usage.adminGetAllUserQuotas.query();

adminGetAllDepartmentQuotas = () => this.client.usage.adminGetAllDepartmentQuotas.query();

adminSetUserQuota = (
  userId: string,
  limits: {
    dailyCostLimit: string | null;
    monthlyCostLimit: string | null;
    dailyTokenLimit: number | null;
    monthlyTokenLimit: number | null;
  },
) => this.client.usage.adminSetUserQuota.mutate({ userId, ...limits });

adminSetDepartmentQuota = (
  department: string,
  limits: {
    dailyCostLimit: string | null;
    monthlyCostLimit: string | null;
    dailyTokenLimit: number | null;
    monthlyTokenLimit: number | null;
  },
) => this.client.usage.adminSetDepartmentQuota.mutate({ department, ...limits });

adminGetUsageByDepartment = (mo?: string) =>
  this.client.usage.adminGetUsageByDepartment.query({ mo });
```

**Step 2: Commit**

```bash
git add src/services/usage.ts
git commit -m "feat(service): add quota client methods to UsageService"
```

---

## Task 9: i18n keys

**Files:**

- Modify: `src/locales/default/auth.ts`
- Modify: `locales/zh-CN/auth.json`
- Modify: `locales/en-US/auth.json`

**Step 1: Add to `src/locales/default/auth.ts`**

```ts
'usage.quota.dailyCost': 'Daily Cost Limit ($)',
'usage.quota.dailyTokens': 'Daily Token Limit',
'usage.quota.exceeded': 'Daily quota exceeded (used ${{cost}} today). Please try again tomorrow.',
'usage.quota.monthlyCost': 'Monthly Cost Limit ($)',
'usage.quota.monthlyTokens': 'Monthly Token Limit',
'usage.quota.noLimit': 'No limit',
'usage.quota.setLimit': 'Set Limit',
'usage.quota.warning': 'Usage has reached {{percent}}%, please be mindful.',
'usage.view.byDepartment': 'By Department',
'usage.view.byUser': 'By User',
```

**Step 2: Add to `locales/zh-CN/auth.json`**

```json
"usage.quota.dailyCost": "每日费用上限（$）",
"usage.quota.dailyTokens": "每日 Token 上限",
"usage.quota.exceeded": "今日用量已达上限（已使用 ${{cost}}），请明天再试",
"usage.quota.monthlyCost": "每月费用上限（$）",
"usage.quota.monthlyTokens": "每月 Token 上限",
"usage.quota.noLimit": "不限制",
"usage.quota.setLimit": "设置限制",
"usage.quota.warning": "用量已达 {{percent}}%，请注意控制使用",
"usage.view.byDepartment": "按部门",
"usage.view.byUser": "按用户"
```

**Step 3: Add to `locales/en-US/auth.json`** (same as default)

**Step 4: Commit**

```bash
git add src/locales/default/auth.ts locales/zh-CN/auth.json locales/en-US/auth.json
git commit -m "feat(i18n): add quota and department view translation keys"
```

---

## Task 10: Admin stats UI — per-user and per-department views

**Files:**

- Modify: `src/routes/(main)/settings/stats/index.tsx`
- Create: `src/routes/(main)/settings/stats/features/usage/AdminUserQuotaTable.tsx`
- Create: `src/routes/(main)/settings/stats/features/usage/AdminDepartmentQuotaTable.tsx`

**Step 1: Create `AdminUserQuotaTable.tsx`**

```tsx
'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { Form, InputNumber, Modal } from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import { useClientDataSWR } from '@/libs/swr';
import { usageService } from '@/services/usage';

const AdminUserQuotaTable = memo(() => {
  const { t } = useTranslation('auth');
  const [editingUser, setEditingUser] = useState<any>(null);
  const [form] = Form.useForm();

  const { data, isLoading, mutate } = useClientDataSWR('admin-user-quotas', () =>
    usageService.adminGetAllUserQuotas(),
  );

  const handleSave = async () => {
    const values = await form.validateFields();
    await usageService.adminSetUserQuota(editingUser.id, {
      dailyCostLimit: values.dailyCostLimit ? String(values.dailyCostLimit) : null,
      dailyTokenLimit: values.dailyTokenLimit ?? null,
      monthlyCostLimit: values.monthlyCostLimit ? String(values.monthlyCostLimit) : null,
      monthlyTokenLimit: values.monthlyTokenLimit ?? null,
    });
    setEditingUser(null);
    mutate();
  };

  const columns = [
    { dataIndex: 'email', key: 'email', title: '邮箱' },
    {
      dataIndex: ['interests', 0],
      key: 'department',
      render: (v: string) => v || '-',
      title: '部门',
    },
    {
      dataIndex: 'dailyCostLimit',
      key: 'dailyCostLimit',
      render: (v: string) => (v ? `$${v}` : t('usage.quota.noLimit')),
      title: t('usage.quota.dailyCost'),
    },
    {
      dataIndex: 'monthlyCostLimit',
      key: 'monthlyCostLimit',
      render: (v: string) => (v ? `$${v}` : t('usage.quota.noLimit')),
      title: t('usage.quota.monthlyCost'),
    },
    {
      dataIndex: 'dailyTokenLimit',
      key: 'dailyTokenLimit',
      render: (v: number) => v ?? t('usage.quota.noLimit'),
      title: t('usage.quota.dailyTokens'),
    },
    {
      dataIndex: 'monthlyTokenLimit',
      key: 'monthlyTokenLimit',
      render: (v: number) => v ?? t('usage.quota.noLimit'),
      title: t('usage.quota.monthlyTokens'),
    },
    {
      key: 'action',
      render: (_: any, record: any) => (
        <Button
          size="small"
          onClick={() => {
            setEditingUser(record);
            form.setFieldsValue(record);
          }}
        >
          {t('usage.quota.setLimit')}
        </Button>
      ),
      title: '',
    },
  ];

  return (
    <>
      <InlineTable
        columns={columns}
        dataSource={data}
        loading={isLoading}
        rowKey="id"
        size="small"
      />
      <Modal
        open={!!editingUser}
        title={`${t('usage.quota.setLimit')} — ${editingUser?.email}`}
        onCancel={() => setEditingUser(null)}
        onOk={handleSave}
      >
        <Form form={form} layout="vertical">
          <Form.Item label={t('usage.quota.dailyCost')} name="dailyCostLimit">
            <InputNumber
              min={0}
              placeholder={t('usage.quota.noLimit')}
              precision={6}
              prefix="$"
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item label={t('usage.quota.monthlyCost')} name="monthlyCostLimit">
            <InputNumber
              min={0}
              placeholder={t('usage.quota.noLimit')}
              precision={6}
              prefix="$"
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item label={t('usage.quota.dailyTokens')} name="dailyTokenLimit">
            <InputNumber min={0} placeholder={t('usage.quota.noLimit')} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label={t('usage.quota.monthlyTokens')} name="monthlyTokenLimit">
            <InputNumber min={0} placeholder={t('usage.quota.noLimit')} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
});

export default AdminUserQuotaTable;
```

**Step 2: Create `AdminDepartmentQuotaTable.tsx`** (same pattern, uses `adminGetAllDepartmentQuotas` and `adminSetDepartmentQuota`, rowKey="department")

**Step 3: Extend stats page Segmented control**

In `src/routes/(main)/settings/stats/index.tsx`, change the admin view state from `boolean` to `'mine' | 'byUser' | 'byDepartment'`:

```tsx
const [adminView, setAdminView] = useState<'mine' | 'byUser' | 'byDepartment'>('mine');
const isAdminView = adminView !== 'mine';
```

Replace the 2-option Segmented with 3 options:

```tsx
options={[
  { icon: <Icon icon={Brain} />, label: t('usage.view.mine'), value: 'mine' },
  { icon: <Icon icon={Users} />, label: t('usage.view.byUser'), value: 'byUser' },
  { icon: <Icon icon={Building2} />, label: t('usage.view.byDepartment'), value: 'byDepartment' },
]}
onChange={(v) => setAdminView(v as any)}
```

Below the FormGroup, add:

```tsx
{
  adminView === 'byUser' && <AdminUserQuotaTable />;
}
{
  adminView === 'byDepartment' && <AdminDepartmentQuotaTable />;
}
```

Import `Building2` from `lucide-react`.

**Step 4: Commit**

```bash
git add src/routes/(main)/settings/stats/
git commit -m "feat(stats): add admin per-user and per-department quota management UI"
```

---

## Task 11: User-side quota progress bars in UsageCards

**Files:**

- Modify: `src/routes/(main)/settings/stats/features/usage/UsageCards/TodaySpend.tsx`
- Modify: `src/routes/(main)/settings/stats/features/usage/UsageCards/MonthSpend.tsx`
- Modify: `src/routes/(main)/settings/stats/features/usage/UsageCards/index.tsx`

**Step 1: Fetch quota in UsageCards index**

In `UsageCards/index.tsx`, add SWR call:

```tsx
const { data: quota } = useClientDataSWR('usage-quota', () => usageService.checkQuota());
```

Pass `quota` as prop to `TodaySpend` and `MonthSpend`.

**Step 2: Add progress bar to TodaySpend**

After the `StatisticCard`, if `quota?.effectiveDailyCostLimit` is set, render:

```tsx
import { Progress } from 'antd';

const pct = quota?.effectiveDailyCostLimit
  ? Math.min(100, (todayCostNum / quota.effectiveDailyCostLimit) * 100)
  : null;

{
  pct !== null && (
    <Progress
      percent={Math.round(pct)}
      size="small"
      status={pct >= 100 ? 'exception' : pct >= 80 ? 'active' : 'normal'}
      strokeColor={pct >= 100 ? undefined : pct >= 80 ? '#faad14' : undefined}
    />
  );
}
```

**Step 3: Same pattern for MonthSpend with `effectiveMonthlyCostLimit`**

**Step 4: Commit**

```bash
git add src/routes/(main)/settings/stats/features/usage/UsageCards/
git commit -m "feat(stats): add quota progress bars to TodaySpend and MonthSpend cards"
```

---

## Task 12: Error message on quota exceeded

**Files:**

- Modify: `src/features/Conversation/ChatInput/index.tsx` (or wherever `sendMessageErrorMsg` is displayed)

**Step 1: Find where sendMessageError is rendered**

In `src/features/Conversation/ChatInput/index.tsx` around line 176-182, the error alert is shown. Find the exact render location.

**Step 2: Parse quota_exceeded error**

Where the error message is rendered, add:

```tsx
const quotaError = (() => {
  try {
    const parsed = JSON.parse(sendMessageErrorMsg || '');
    if (parsed?.reason === 'quota_exceeded') return parsed;
  } catch {}
  return null;
})();

const errorDisplay = quotaError
  ? t('usage.quota.exceeded', { cost: formatNumber(quotaError.todayCost, 6) })
  : sendMessageErrorMsg;
```

Use `errorDisplay` instead of `sendMessageErrorMsg` in the alert.

Import `formatNumber` from `@/utils/format`.

**Step 3: Commit**

```bash
git add src/features/Conversation/ChatInput/index.tsx
git commit -m "feat(chat): show today's spend in quota exceeded error message"
```

---

## Task 13: Type check

**Step 1: Run type check**

```bash
bun run type-check
```

Expected: no errors. Fix any type issues found.

**Step 2: Final commit if fixes needed**

```bash
git add -p
git commit -m "fix(types): resolve type errors from quota feature"
```

---

## Verification

1. `bun run db:generate` → new migration file created
2. `bun run db:migrate` → migration applied
3. Admin UI: set daily cost limit of $0.001 on test user
4. Send a message → if today's spend > $0.001, request blocked with error showing today's spend
5. Set limit to $100 → send message → warning toast at 80%
6. Set department quota lower than user quota → verify department limit takes effect
7. Admin stats page → "按用户" tab shows all users with quota columns
8. Admin stats page → "按部门" tab shows department aggregates
9. `bun run type-check` → passes
