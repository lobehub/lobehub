export * from './formatSearchResults';

/**
 * User memory item interfaces
 */
export interface UserMemoryContextItem {
  description?: string | null;
  id?: string;
  title?: string | null;
}

export interface UserMemoryExperienceItem {
  id?: string;
  keyLearning?: string | null;
  situation?: string | null;
}

export interface UserMemoryPreferenceItem {
  conclusionDirectives?: string | null;
  id?: string;
}

export type IdentityType = 'demographic' | 'personal' | 'professional';

export interface UserMemoryIdentityItem {
  description?: string | null;
  id?: string;
  role?: string | null;
  type?: IdentityType | string | null;
}

export interface UserMemoryData {
  contexts?: UserMemoryContextItem[];
  experiences?: UserMemoryExperienceItem[];
  identities?: UserMemoryIdentityItem[];
  preferences?: UserMemoryPreferenceItem[];
}

export interface PromptUserMemoryOptions {
  /** User memories data */
  memories: UserMemoryData;
}

/**
 * Check if a context item has meaningful content
 */
const isValidContextItem = (item: UserMemoryContextItem): boolean => {
  return !!(item.id || item.title || item.description);
};

/**
 * Formats a single context memory item
 * title as attribute, description as children
 */
const formatContextItem = (item: UserMemoryContextItem): string => {
  return `  <context id="${item.id || ''}" title="${item.title || ''}">${item.description || ''}</context>`;
};

/**
 * Check if an experience item has meaningful content
 */
const isValidExperienceItem = (item: UserMemoryExperienceItem): boolean => {
  return !!(item.id || item.situation || item.keyLearning);
};

/**
 * Formats a single experience memory item
 */
const formatExperienceItem = (item: UserMemoryExperienceItem): string => {
  return `  <experience id="${item.id || ''}">
    <situation>${item.situation || ''}</situation>
    <key_learning>${item.keyLearning || ''}</key_learning>
  </experience>`;
};

/**
 * Check if a preference item has meaningful content
 */
const isValidPreferenceItem = (item: UserMemoryPreferenceItem): boolean => {
  return !!item.conclusionDirectives;
};

/**
 * Formats a single preference memory item
 */
const formatPreferenceItem = (item: UserMemoryPreferenceItem): string => {
  return `  <preference id="${item.id || ''}">${item.conclusionDirectives}</preference>`;
};

/**
 * Check if an identity item has meaningful content
 */
const isValidIdentityItem = (item: UserMemoryIdentityItem): boolean => {
  return !!(item.id || item.description || item.role || item.type);
};

/**
 * Formats a single identity memory item
 */
const formatIdentityItem = (item: UserMemoryIdentityItem): string => {
  const typeAttr = item.type ? ` type="${item.type}"` : '';
  const roleAttr = item.role ? ` role="${item.role}"` : '';
  const idAttr = item.id ? ` id="${item.id}"` : '';
  return `  <identity${typeAttr}${roleAttr}${idAttr}>${item.description || ''}</identity>`;
};

/**
 * Format user memories as unified XML prompt
 *
 * The memories are organized into four categories:
 * - identities: User's identity information (who the user is)
 * - contexts: Background information about the user's situation
 * - experiences: Past interactions and learnings
 * - preferences: User's stated preferences and directives
 */
export const promptUserMemory = ({ memories }: PromptUserMemoryOptions): string => {
  // Filter out empty/invalid items
  const identities = (memories.identities || []).filter(isValidIdentityItem);
  const contexts = (memories.contexts || []).filter(isValidContextItem);
  const experiences = (memories.experiences || []).filter(isValidExperienceItem);
  const preferences = (memories.preferences || []).filter(isValidPreferenceItem);

  const hasIdentities = identities.length > 0;
  const hasContexts = contexts.length > 0;
  const hasExperiences = experiences.length > 0;
  const hasPreferences = preferences.length > 0;

  // If no memories at all, return empty
  if (!hasIdentities && !hasContexts && !hasExperiences && !hasPreferences) {
    return '';
  }

  const contentParts: string[] = [
    '<instruction>The following are memories about this user retrieved from previous conversations. Use this information to personalize your responses and maintain continuity.</instruction>',
  ];

  // Add instruction

  // Add identities section (user's identity information)
  if (hasIdentities) {
    const identitiesXml = identities.map((item) => formatIdentityItem(item)).join('\n');
    contentParts.push(`<identities count="${identities.length}">
${identitiesXml}
</identities>`);
  }

  // Add contexts section
  if (hasContexts) {
    const contextsXml = contexts.map((item) => formatContextItem(item)).join('\n');
    contentParts.push(`<contexts count="${contexts.length}">
${contextsXml}
</contexts>`);
  }

  // Add experiences section
  if (hasExperiences) {
    const experiencesXml = experiences.map((item) => formatExperienceItem(item)).join('\n');
    contentParts.push(`<experiences count="${experiences.length}">
${experiencesXml}
</experiences>`);
  }

  // Add preferences section
  if (hasPreferences) {
    const preferencesXml = preferences.map((item) => formatPreferenceItem(item)).join('\n');
    contentParts.push(`<preferences count="${preferences.length}">
${preferencesXml}
</preferences>`);
  }

  return `<user_memory>
${contentParts.join('\n')}
</user_memory>`;
};
