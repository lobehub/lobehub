import { describe, expect, it } from 'vitest';

import enUSOauth from '../../../../locales/en-US/oauth.json';
import enUSProject from '../../../../locales/en-US/project.json';
import zhCNOauth from '../../../../locales/zh-CN/oauth.json';
import zhCNProject from '../../../../locales/zh-CN/project.json';
import oauth from './oauth';
import project from './project';

const FEATURE_KEY =
  /^(review\.sites\.|consent\.acceptanceReview\.|consent\.scope\.acceptance-review)/;

const offending = (resources: Record<string, unknown>) =>
  Object.entries(resources).filter(
    ([key, value]) =>
      FEATURE_KEY.test(key) && typeof value === 'string' && /\breview|评审/i.test(value),
  );

describe('acceptance copy', () => {
  it.each([
    ['default project', project],
    ['default oauth', oauth],
    ['en-US project', enUSProject],
    ['en-US oauth', enUSOauth],
    ['zh-CN project', zhCNProject],
    ['zh-CN oauth', zhCNOauth],
  ])('calls site and toolbar access acceptance, never review (%s)', (_, resources) => {
    expect(offending(resources as Record<string, unknown>)).toEqual([]);
  });
});
