const DEFAULT_DEPARTMENT = '其他';

interface DepartmentQuotaSource {
  dailyCostLimit: number | null;
  dailyTokenLimit: number | null;
  department: string;
  monthlyCostLimit: number | null;
  monthlyTokenLimit: number | null;
}

interface UserDepartmentSource {
  interests?: string[] | null;
}

export interface DepartmentQuotaRow {
  dailyCostLimit: number | null;
  dailyTokenLimit: number | null;
  department: string;
  monthlyCostLimit: number | null;
  monthlyTokenLimit: number | null;
}

const normalizeDepartment = (department?: string | null) => {
  const trimmed = department?.trim();
  if (trimmed) return trimmed;
  return DEFAULT_DEPARTMENT;
};

export const buildDepartmentQuotaRows = (
  users?: UserDepartmentSource[],
  quotas?: DepartmentQuotaSource[],
): DepartmentQuotaRow[] => {
  const normalizedQuotas = (quotas || []).map((quota) => ({
    ...quota,
    department: normalizeDepartment(quota.department),
  }));

  const quotaMap = new Map(normalizedQuotas.map((quota) => [quota.department, quota]));
  const departmentSet = new Set<string>();

  for (const user of users || []) {
    departmentSet.add(normalizeDepartment(user.interests?.[0]));
  }

  for (const quota of normalizedQuotas) {
    departmentSet.add(quota.department);
  }

  return Array.from(departmentSet)
    .sort((a, b) => a.localeCompare(b))
    .map((department) => {
      const quota = quotaMap.get(department);

      return {
        dailyCostLimit: quota?.dailyCostLimit ?? null,
        dailyTokenLimit: quota?.dailyTokenLimit ?? null,
        department,
        monthlyCostLimit: quota?.monthlyCostLimit ?? null,
        monthlyTokenLimit: quota?.monthlyTokenLimit ?? null,
      };
    });
};
