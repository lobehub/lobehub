/**
 * Compile-time check that the row and insert types declared in `@lobechat/types`
 * (`packages/types/src/userMemory/rows.ts`) are identical to these tables. The rest of the code
 * base imports those declared types; this file is the only place that infers from the schema.
 * A mismatch fails `type-check`.
 */
import type {
  UserMemory,
  UserMemoryActivity,
  UserMemoryActivityInsert,
  UserMemoryContext,
  UserMemoryContextInsert,
  UserMemoryContextProject,
  UserMemoryContextProjectInsert,
  UserMemoryDossier,
  UserMemoryDossierInsert,
  UserMemoryEdge,
  UserMemoryEdgeInsert,
  UserMemoryEntity,
  UserMemoryEntityInsert,
  UserMemoryEntityName,
  UserMemoryEntityNameInsert,
  UserMemoryExperience,
  UserMemoryExperienceInsert,
  UserMemoryIdentity,
  UserMemoryIdentityInsert,
  UserMemoryInsert,
  UserMemoryOperation,
  UserMemoryOperationInsert,
  UserMemoryPreference,
  UserMemoryPreferenceInsert,
  UserPersonaDocument,
  UserPersonaDocumentHistory,
  UserPersonaDocumentHistoryInsert,
  UserPersonaDocumentInsert,
} from '@lobechat/types';

import type {
  userMemories,
  userMemoriesActivities,
  userMemoriesContextProjects,
  userMemoriesContexts,
  userMemoriesDossiers,
  userMemoriesEdges,
  userMemoriesEntities,
  userMemoriesEntityNames,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesOperations,
  userMemoriesPreferences,
  userPersonaDocumentHistories,
  userPersonaDocuments,
} from './index';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type UserMemoryRowTypesMatchSchema = [
  Assert<Equal<UserMemory, typeof userMemories.$inferSelect>>,
  Assert<Equal<UserMemoryInsert, typeof userMemories.$inferInsert>>,
  Assert<Equal<UserMemoryContext, typeof userMemoriesContexts.$inferSelect>>,
  Assert<Equal<UserMemoryContextInsert, typeof userMemoriesContexts.$inferInsert>>,
  Assert<Equal<UserMemoryDossier, typeof userMemoriesDossiers.$inferSelect>>,
  Assert<Equal<UserMemoryDossierInsert, typeof userMemoriesDossiers.$inferInsert>>,
  Assert<Equal<UserMemoryContextProject, typeof userMemoriesContextProjects.$inferSelect>>,
  Assert<Equal<UserMemoryContextProjectInsert, typeof userMemoriesContextProjects.$inferInsert>>,
  Assert<Equal<UserMemoryActivity, typeof userMemoriesActivities.$inferSelect>>,
  Assert<Equal<UserMemoryActivityInsert, typeof userMemoriesActivities.$inferInsert>>,
  Assert<Equal<UserMemoryIdentity, typeof userMemoriesIdentities.$inferSelect>>,
  Assert<Equal<UserMemoryIdentityInsert, typeof userMemoriesIdentities.$inferInsert>>,
  Assert<Equal<UserMemoryPreference, typeof userMemoriesPreferences.$inferSelect>>,
  Assert<Equal<UserMemoryPreferenceInsert, typeof userMemoriesPreferences.$inferInsert>>,
  Assert<Equal<UserMemoryExperience, typeof userMemoriesExperiences.$inferSelect>>,
  Assert<Equal<UserMemoryExperienceInsert, typeof userMemoriesExperiences.$inferInsert>>,
  Assert<Equal<UserMemoryEntity, typeof userMemoriesEntities.$inferSelect>>,
  Assert<Equal<UserMemoryEntityInsert, typeof userMemoriesEntities.$inferInsert>>,
  Assert<Equal<UserMemoryEntityName, typeof userMemoriesEntityNames.$inferSelect>>,
  Assert<Equal<UserMemoryEntityNameInsert, typeof userMemoriesEntityNames.$inferInsert>>,
  Assert<Equal<UserMemoryEdge, typeof userMemoriesEdges.$inferSelect>>,
  Assert<Equal<UserMemoryEdgeInsert, typeof userMemoriesEdges.$inferInsert>>,
  Assert<Equal<UserMemoryOperation, typeof userMemoriesOperations.$inferSelect>>,
  Assert<Equal<UserMemoryOperationInsert, typeof userMemoriesOperations.$inferInsert>>,
  Assert<Equal<UserPersonaDocument, typeof userPersonaDocuments.$inferSelect>>,
  Assert<Equal<UserPersonaDocumentInsert, typeof userPersonaDocuments.$inferInsert>>,
  Assert<Equal<UserPersonaDocumentHistory, typeof userPersonaDocumentHistories.$inferSelect>>,
  Assert<Equal<UserPersonaDocumentHistoryInsert, typeof userPersonaDocumentHistories.$inferInsert>>,
];
