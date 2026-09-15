import type {
  ExpertiseCanonEntry,
  ExpertiseLessonPolarity,
  ExpertiseLessonSection,
} from '@lobechat/types';

import { escapeXmlAttr, escapeXmlContent } from '../prompts/search/xmlEscape';

const normalizeText = (value: string) => escapeXmlContent(value.replaceAll(/\s+/g, ' ').trim());

const sectionLabels: Record<ExpertiseLessonSection['key'], string> = {
  breaks: 'Breaks',
  correct: 'Correct',
  dont: 'Avoid',
  good: 'Good',
  how: 'How',
  limits: 'Limits',
  rule: 'Rule',
  why: 'Why',
  works: 'Works',
  wrong: 'Wrong',
};

export interface ExpertisePromptLesson {
  code: string;
  layer: null | string;
  polarity: ExpertiseLessonPolarity;
  sections: ExpertiseLessonSection[];
  title: string;
}

export interface ExpertisePromptDomain {
  canonEntries: ExpertiseCanonEntry[];
  domainFilter: string;
  flow: string[];
  lessons: ExpertisePromptLesson[];
  outOfScope: null | string;
  slug: string;
  title: string;
}

export const promptExpertise = (domains: ExpertisePromptDomain[]) => {
  if (domains.length === 0) return '';

  const renderedDomains = domains.map((domain) => {
    const sections = [
      `<domain id="${escapeXmlAttr(domain.slug)}" name="${escapeXmlAttr(domain.title)}">`,
      '',
      `Scope: ${normalizeText(domain.domainFilter)}`,
    ];

    if (domain.outOfScope?.trim()) sections.push(`Excludes: ${normalizeText(domain.outOfScope)}`);

    if (domain.canonEntries.length > 0) {
      sections.push('', '## Canon', '');
      for (const entry of domain.canonEntries) {
        sections.push(
          `- ${normalizeText(entry.key)} · ${normalizeText(entry.title)}: ${normalizeText(entry.statement)} (${normalizeText(entry.source)})`,
        );
      }
    }

    if (domain.flow.length > 0) {
      sections.push('', '## Workflow', '');
      domain.flow.forEach((step, index) => sections.push(`${index + 1}. ${normalizeText(step)}`));
    }

    if (domain.lessons.length > 0) {
      sections.push('', '## Lessons');
      for (const lesson of domain.lessons) {
        const metadata = [lesson.code, lesson.polarity.toUpperCase(), lesson.layer]
          .filter(Boolean)
          .join(' · ');
        sections.push('', `### ${metadata} — ${normalizeText(lesson.title)}`, '');
        for (const section of lesson.sections) {
          sections.push(`${sectionLabels[section.key]}: ${normalizeText(section.body)}`);
        }
      }
    }

    sections.push('', '</domain>');
    return sections.join('\n');
  });

  return [
    '<expertise>',
    'Use applicable domains as learned guidance. Apply a domain only when the task falls within its scope. Explicit user instructions take precedence.',
    '',
    renderedDomains.join('\n\n'),
    '</expertise>',
  ].join('\n');
};
