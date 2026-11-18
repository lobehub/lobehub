import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { SkillCategory } from '@/types/discover';

import { useSkillCategory, useSkillCategorySections } from './useSkillCategory';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('uses the same ordered, localized browse sections as the market menu without the All shortcut', () => {
  const { result } = renderHook(() => ({
    menu: useSkillCategory(),
    sections: useSkillCategorySections(),
  }));
  expect(result.current.sections).toEqual(
    result.current.menu.filter((c) => c.key !== SkillCategory.All),
  );
  expect(result.current.sections.slice(0, 4).map((c) => c.key)).toEqual([
    'coding-agents-ides',
    'web-frontend-development',
    'devops-cloud',
    'search-research',
  ]);
});
