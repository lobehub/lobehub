import { towerAIStore, type TowerAITokenState } from './store';

const DEFAULT_BASE_URL = 'https://tower-ai.yottastudios.com';

type PageStage = 'app' | 'oa' | 'signin' | 'unknown';

function detectStage(url: string, baseUrl: string): PageStage {
  const normalized = baseUrl.replace(/\/$/, '');
  if (url.includes('/next-auth/signin') || url.includes('/next-auth/signin')) return 'signin';
  if (url.includes('oa.xinyoudi.com') || url.includes('/oa/')) return 'oa';
  if (url.startsWith(normalized) && !url.includes('/next-auth/')) return 'app';
  return 'unknown';
}

async function extractTokensFromPage(page: any): Promise<TowerAITokenState | null> {
  try {
    const cookies = await page.context().cookies();
    const tokenCookie = cookies.find((c: any) => c.name === 'token' || c.name === '__Secure-next-auth.session-token');
    const authTokenCookie = cookies.find((c: any) => c.name === 'authToken' || c.name === 'auth_token');

    // Try localStorage as fallback
    const localStorageToken = await page.evaluate(() => {
      return {
        authToken: localStorage.getItem('authToken') || '',
        token: localStorage.getItem('token') || '',
      };
    }).catch(() => ({ authToken: '', token: '' }));

    const token = tokenCookie?.value || localStorageToken.token;
    const authToken = authTokenCookie?.value || localStorageToken.authToken;

    if (token) {
      return { authToken, token };
    }
    return null;
  } catch {
    return null;
  }
}

export async function loginWithCredentials(options: {
  baseUrl?: string;
  headless?: boolean;
  oaPassword: string;
  oaUsername: string;
  timeoutMs?: number;
}): Promise<TowerAITokenState> {
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs || 60_000;

  // Dynamically import playwright — must be installed separately
  let playwright: any;
  try {
    playwright = await import('playwright');
  } catch {
    throw new Error(
      'Playwright is required for auto-login. Install it with: npm install playwright && npx playwright install chromium',
    );
  }

  const browser = await playwright.chromium.launch({ headless: options.headless ?? true });
  const page = await browser.newPage();

  try {
    await page.goto(baseUrl, { timeout: timeoutMs });
    await page.waitForTimeout(2000);

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const url = page.url();
      const stage = detectStage(url, baseUrl);

      if (stage === 'app') {
        const tokens = await extractTokensFromPage(page);
        if (tokens) {
          towerAIStore.set(tokens);
          return tokens;
        }
        break;
      }

      if (stage === 'signin') {
        // Click sign in with OA/SSO
        const oaButton = await page.$('button:has-text("OA"), a:has-text("企业"), [data-provider="oa"]');
        if (oaButton) {
          await oaButton.click();
          await page.waitForTimeout(2000);
        }
        continue;
      }

      if (stage === 'oa') {
        const emailSelectors = ['input[name="email"]', 'input[placeholder="企业邮箱"]', 'input[type="text"]'];
        const passwordSelectors = ['input[name="password"]', 'input[placeholder="密码"]', 'input[type="password"]'];

        for (const sel of emailSelectors) {
          const el = await page.$(sel);
          if (el) { await el.fill(options.oaUsername); break; }
        }
        for (const sel of passwordSelectors) {
          const el = await page.$(sel);
          if (el) { await el.fill(options.oaPassword); break; }
        }

        const submitBtn = await page.$('button[type="submit"], button:has-text("登录")');
        if (submitBtn) {
          await submitBtn.click();
          await page.waitForTimeout(3000);
        }
        continue;
      }

      await page.waitForTimeout(1000);
    }

    throw new Error('Login timed out or failed — check credentials');
  } finally {
    await browser.close();
  }
}
