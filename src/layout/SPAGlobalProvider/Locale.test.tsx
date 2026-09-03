/**
 * @vitest-environment happy-dom
 */
import { render, waitFor } from '@testing-library/react';
import { type PropsWithChildren, useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAntdLocale } = vi.hoisted(() => ({ getAntdLocale: vi.fn() }));

vi.mock('@/utils/locale', () => ({ getAntdLocale }));
vi.mock('@/utils/dayjsLocale', () => ({
  loadDayjsLocaleModule: vi.fn(async () => ({ default: {} })),
  normalizeDayjsLocale: (lang: string) => lang,
}));
vi.mock('@/locales/create', () => ({
  createI18nNext: () => ({
    init: vi.fn(async () => {}),
    instance: { isInitialized: true, language: 'zh-CN', off: vi.fn(), on: vi.fn() },
  }),
}));
vi.mock('@/layout/GlobalProvider/Editor', () => ({
  default: ({ children }: PropsWithChildren) => children,
}));

const Locale = (await import('./Locale')).default;

let mounts = 0;

const MountCounter = () => {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <div>child</div>;
};

describe('Locale', () => {
  beforeEach(() => {
    mounts = 0;
    getAntdLocale.mockReset();
  });

  it('keeps the subtree mounted when the antd locale resolves', async () => {
    let resolveLocale: (value: unknown) => void = () => {};
    getAntdLocale.mockReturnValue(
      new Promise((resolve) => {
        resolveLocale = resolve;
      }),
    );

    render(
      <Locale defaultLang="zh-CN">
        <MountCounter />
      </Locale>,
    );
    expect(mounts).toBe(1);

    resolveLocale({ locale: 'zh-cn' });
    await waitFor(() => expect(getAntdLocale).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));

    // antd's ConfigProvider only wraps children in `LocaleProvider` when `locale` is
    // truthy — a falsy-to-resolved transition would insert a node and remount everything.
    expect(mounts).toBe(1);
  });
});
