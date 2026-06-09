export interface Permission {
  allowed: boolean;
  reason: string;
}

export const usePermission = (_action: string): Permission => ({
  allowed: true,
  reason: '',
});
