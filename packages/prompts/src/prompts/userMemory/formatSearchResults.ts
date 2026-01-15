import type { SearchMemoryResult } from '@lobechat/types';

/**
 * Search result item interfaces matching the SearchMemoryResult type
 */
type ContextResult = SearchMemoryResult['contexts'][number];
type ExperienceResult = SearchMemoryResult['experiences'][number];
type PreferenceResult = SearchMemoryResult['preferences'][number];

/**
 * Format a single context memory item for search results
 * Format: attributes for metadata, description as text content
 */
const formatContextResult = (item: ContextResult): string => {
  const attrs: string[] = [`id="${item.id}"`];

  if (item.title) {
    attrs.push(`title="${item.title}"`);
  }
  if (item.scoreUrgency !== null && item.scoreUrgency !== undefined) {
    attrs.push(`urgency=${item.scoreUrgency}`);
  }
  if (item.scoreImpact !== null && item.scoreImpact !== undefined) {
    attrs.push(`impact=${item.scoreImpact}`);
  }
  if (item.type) {
    attrs.push(`type="${item.type}"`);
  }
  if (item.currentStatus) {
    attrs.push(`status="${item.currentStatus}"`);
  }

  const children: string[] = [];

  // Description as main text content
  if (item.description) {
    children.push(`    ${item.description}`);
  }

  // Associated subjects (actors)
  if (item.associatedSubjects && item.associatedSubjects.length > 0) {
    const subjects = item.associatedSubjects
      .filter((s) => s?.name)
      .map((s) => `${s.name}${s.type ? ` (${s.type})` : ''}`)
      .join(', ');
    if (subjects) {
      children.push(`    <subjects>${subjects}</subjects>`);
    }
  }

  // Associated objects (resources)
  if (item.associatedObjects && item.associatedObjects.length > 0) {
    const objects = item.associatedObjects
      .filter((o) => o?.name)
      .map((o) => `${o.name}${o.type ? ` (${o.type})` : ''}`)
      .join(', ');
    if (objects) {
      children.push(`    <objects>${objects}</objects>`);
    }
  }

  const content = children.length > 0 ? `\n${children.join('\n')}\n  ` : '';

  return `  <context ${attrs.join(' ')}>${content}</context>`;
};

/**
 * Format a single experience memory item for search results
 * Format: attributes for metadata, situation and keyLearning as child elements
 */
const formatExperienceResult = (item: ExperienceResult): string => {
  const attrs: string[] = [`id="${item.id}"`];

  if (item.type) {
    attrs.push(`type="${item.type}"`);
  }
  if (item.scoreConfidence !== null && item.scoreConfidence !== undefined) {
    attrs.push(`confidence=${item.scoreConfidence}`);
  }

  const children: string[] = [];

  if (item.situation) {
    children.push(`    <situation>${item.situation}</situation>`);
  }
  if (item.keyLearning) {
    children.push(`    <keyLearning>${item.keyLearning}</keyLearning>`);
  }

  const content = children.length > 0 ? `\n${children.join('\n')}\n  ` : '';

  return `  <experience ${attrs.join(' ')}>${content}</experience>`;
};

/**
 * Format a single preference memory item for search results
 * Format: attributes for metadata, directives as text content
 */
const formatPreferenceResult = (item: PreferenceResult): string => {
  const attrs: string[] = [`id="${item.id}"`];

  if (item.type) {
    attrs.push(`type="${item.type}"`);
  }
  if (item.scorePriority !== null && item.scorePriority !== undefined) {
    attrs.push(`priority=${item.scorePriority}`);
  }

  const content = item.conclusionDirectives || '';

  return `  <preference ${attrs.join(' ')}>${content}</preference>`;
};

export interface FormatSearchResultsOptions {
  /** The search query that was used */
  query: string;
  /** The search results to format */
  results: SearchMemoryResult;
}

/**
 * Format memory search results as XML for LLM consumption.
 *
 * This function formats the complete search results with all content details,
 * making the retrieved memories directly usable by the LLM for reasoning
 * and response generation.
 */
export const formatMemorySearchResults = ({
  query,
  results,
}: FormatSearchResultsOptions): string => {
  const { contexts, experiences, preferences } = results;
  const total = contexts.length + experiences.length + preferences.length;

  if (total === 0) {
    return `<memories query="${query}">
  <status>No memories found matching the query.</status>
</memories>`;
  }

  const sections: string[] = [];

  // Add contexts section
  if (contexts.length > 0) {
    const contextsXml = contexts.map(formatContextResult).join('\n');
    sections.push(`<contexts count="${contexts.length}">\n${contextsXml}\n</contexts>`);
  }

  // Add experiences section
  if (experiences.length > 0) {
    const experiencesXml = experiences.map(formatExperienceResult).join('\n');
    sections.push(`<experiences count="${experiences.length}">\n${experiencesXml}\n</experiences>`);
  }

  // Add preferences section
  if (preferences.length > 0) {
    const preferencesXml = preferences.map(formatPreferenceResult).join('\n');
    sections.push(`<preferences count="${preferences.length}">\n${preferencesXml}\n</preferences>`);
  }

  return `<memories query="${query}" total="${total}">
${sections.join('\n')}
</memories>`;
};
