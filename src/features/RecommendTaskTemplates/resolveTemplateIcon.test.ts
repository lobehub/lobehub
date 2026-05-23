import { SiGithub } from '@icons-pack/react-simple-icons';
import type { TaskTemplate } from '@lobechat/const';
import { BookOpen, type LucideIcon, Sparkles } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { resolveTemplateIcon } from './resolveTemplateIcon';

const baseTemplate = {
  category: 'engineering',
  cronPattern: '0 9 * * *',
  id: 'test-template',
  interests: [],
} satisfies Pick<TaskTemplate, 'category' | 'cronPattern' | 'id' | 'interests'>;

const make = (overrides: Partial<TaskTemplate>): TaskTemplate =>
  ({ ...baseTemplate, ...overrides }) as TaskTemplate;

const interestMap = new Map<string, LucideIcon>([['coding', BookOpen]]);

describe('resolveTemplateIcon', () => {
  it('uses self icon when template.icon is set', () => {
    const spec = resolveTemplateIcon(make({ icon: 'github', interests: ['coding'] }), interestMap);
    expect(spec).toEqual({ Comp: SiGithub, kind: 'component' });
  });

  it('falls back to a required skill provider icon (component form)', () => {
    const spec = resolveTemplateIcon(
      make({
        interests: ['coding'],
        requiresSkills: [{ provider: 'github', source: 'lobehub' }],
      }),
      interestMap,
    );
    expect(spec).toEqual({ Comp: SiGithub, kind: 'component' });
  });

  it('falls back to a required skill provider icon (URL form)', () => {
    const spec = resolveTemplateIcon(
      make({
        interests: ['coding'],
        requiresSkills: [{ provider: 'gmail', source: 'klavis' }],
      }),
      interestMap,
    );
    expect(spec.kind).toBe('url');
    if (spec.kind === 'url') expect(spec.src).toMatch(/gmail/);
  });

  it('prefers required over optional when both are present', () => {
    const spec = resolveTemplateIcon(
      make({
        optionalSkills: [{ provider: 'notion', source: 'lobehub' }],
        requiresSkills: [{ provider: 'github', source: 'lobehub' }],
      }),
      interestMap,
    );
    expect(spec).toEqual({ Comp: SiGithub, kind: 'component' });
  });

  it('falls back to optional skill icon when required is absent', () => {
    const spec = resolveTemplateIcon(
      make({
        interests: ['coding'],
        optionalSkills: [{ provider: 'notion', source: 'lobehub' }],
      }),
      interestMap,
    );
    expect(spec.kind).toBe('url');
    if (spec.kind === 'url') expect(spec.src).toMatch(/notion/);
  });

  it('skips unresolvable required spec and tries optional', () => {
    const spec = resolveTemplateIcon(
      make({
        optionalSkills: [{ provider: 'notion', source: 'lobehub' }],
        requiresSkills: [{ provider: 'nonexistent-x', source: 'lobehub' }],
      }),
      interestMap,
    );
    expect(spec.kind).toBe('url');
    if (spec.kind === 'url') expect(spec.src).toMatch(/notion/);
  });

  it('uses interest icon when self and skill icons are absent', () => {
    const spec = resolveTemplateIcon(make({ interests: ['coding'] }), interestMap);
    expect(spec).toEqual({ Comp: BookOpen, kind: 'component' });
  });

  it('falls back to Sparkles when nothing else resolves', () => {
    const spec = resolveTemplateIcon(make({ interests: [] }), interestMap);
    expect(spec).toEqual({ Comp: Sparkles, kind: 'component' });
  });

  it('falls back to Sparkles when interest key is unknown to the map', () => {
    const spec = resolveTemplateIcon(
      make({ interests: ['interest-not-in-map'] as unknown as TaskTemplate['interests'] }),
      interestMap,
    );
    expect(spec).toEqual({ Comp: Sparkles, kind: 'component' });
  });
});
