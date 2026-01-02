export const MemoryApiName = {
  addContextMemory: 'addContextMemory',
  addExperienceMemory: 'addExperienceMemory',
  addIdentityMemory: 'addIdentityMemory',
  addPreferenceMemory: 'addPreferenceMemory',
  removeIdentityMemory: 'removeIdentityMemory',
  searchUserMemory: 'searchUserMemory',
  updateIdentityMemory: 'updateIdentityMemory',
} as const;

export type MemoryApiNameType = (typeof MemoryApiName)[keyof typeof MemoryApiName];

/** @deprecated Use MemoryApiName instead */
export const UserMemoryApiName = MemoryApiName;
