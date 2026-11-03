import { PERMISSION_ACTIONS } from '@/const/rbac';

export const getResourceType = (permissionKey: keyof typeof PERMISSION_ACTIONS) => {
  return PERMISSION_ACTIONS[permissionKey].split(':')[0];
};

export const getActionType = (permissionKey: keyof typeof PERMISSION_ACTIONS) => {
  return PERMISSION_ACTIONS[permissionKey].split(':')[1];
};
