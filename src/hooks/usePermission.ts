export interface Permission {
  allowed: boolean;
  /**
   * Localised tooltip text explaining why the action is blocked. `undefined`
   * when allowed, so unconditional `<Tooltip title={reason}>` wrappers render
   * nothing instead of an empty tooltip bubble (Tooltip only skips nullish
   * titles, not empty strings).
   */
  reason?: string;
}

export const usePermission = (_action: string): Permission => ({
  allowed: true,
  reason: undefined,
});
