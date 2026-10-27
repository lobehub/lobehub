import '@/styles/stylex.css';
import 'katex/dist/katex.min.css';

import { Center, Empty } from '@lobehub/ui';
import dayjs from 'dayjs';
import zhCn from 'dayjs/locale/zh-cn';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';

import BootErrorBoundary from '@/components/BootErrorBoundary';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { normalizeDayjsLocale } from '@/utils/dayjsLocale';

import { loadWorkbenchResources } from '../shell/createWorkbenchI18n';
import WorkbenchShell from '../shell/WorkbenchShell';
import { LocalAcceptanceReport } from './LocalAcceptanceReport';
import { getLocalReport } from './localReportData';

const render = async () => {
  const locale = document.documentElement.lang || navigator.language || 'en-US';
  const resources = await loadWorkbenchResources(locale);
  // Relative times render once — nothing re-renders a static page after the
  // shell's async locale load — so the date locale is set before the first paint.
  // The locale object, not its name: it registers on this dayjs instance.
  if (normalizeDayjsLocale(locale) === 'zh-cn') dayjs.locale(zhCn);

  let acceptanceId: string | undefined;
  let failure: string | undefined;
  try {
    acceptanceId = getLocalReport().acceptanceId;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  createRoot(document.getElementById('root')!).render(
    <BootErrorBoundary>
      <NextThemeProvider>
        <WorkbenchShell enableCustomFonts={false} locale={locale} resources={resources}>
          {/* The viewer's filters and links read a router; the page has one URL. */}
          <MemoryRouter>
            {acceptanceId ? (
              <LocalAcceptanceReport acceptanceId={acceptanceId} />
            ) : (
              <Center height={'100dvh'}>
                <Empty description={failure} title={'This report could not be opened'} />
              </Center>
            )}
          </MemoryRouter>
        </WorkbenchShell>
      </NextThemeProvider>
    </BootErrorBoundary>,
  );
};

void render();
