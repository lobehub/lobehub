import '@lobehub/ui/theme.css';
import '@lobehub/ui/global.css';
import '@lobehub/ui/style.css';
import '@/styles/stylex.css';

import { ConfigProvider } from '@lobehub/ui';
import * as motion from 'motion/react-m';
import { type ComponentType, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';

const Ready = () => {
  useLayoutEffect(() => {
    document.getElementById('app')?.setAttribute('data-verification-ready', 'true');
  }, []);
  return null;
};

/** This identical module is copied and built independently inside B and M. */
export const startFixture = (
  Fixture: ComponentType<{ variant: string }>,
  variants: string[],
  containerMode: 'component-root' | 'fixture-wrapper',
) => {
  const root = document.getElementById('app');
  if (!root) throw new Error('FIXTURE_ROOT_MISSING');
  const variant = new URL(location.href).searchParams.get('variant') ?? variants[0];
  if (!variants.includes(variant)) throw new Error('UNKNOWN_STYLE_VARIANT');
  document.body.style.margin = '0';
  document.body.style.fontFamily = 'Arial, sans-serif';
  createRoot(root).render(
    <ConfigProvider enableCustomFonts={false} motion={motion}>
      <main data-case-root data-verification-host style={{ padding: 16, width: 920 }}>
        <div data-component-mount>
          {containerMode === 'component-root' ? (
            <Fixture variant={variant} />
          ) : (
            <div>
              <Fixture variant={variant} />
            </div>
          )}
        </div>
      </main>
      <Ready />
    </ConfigProvider>,
  );
};
