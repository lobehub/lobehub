import { BRANDING_NAME, BRANDING_WORDMARK_URL } from '@lobechat/business-const';

// Subset of the TITU Work hero face (Alimama ShuHeiTi Bold) covering only the
// glyphs this page renders: the 404 numeral and the title.
const HERO_FONT =
  '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';

const TITLE = '文件不存在';
const DESCRIPTION = '文件可能已被删除，或链接有误。';

const escapeHtml = (value: string) =>
  value.replaceAll(/["&'<>]/g, (char) => `&#${char.charCodeAt(0)};`);

const renderPage = () => {
  const name = escapeHtml(BRANDING_NAME);
  const brand = BRANDING_WORDMARK_URL
    ? `<img src="${escapeHtml(BRANDING_WORDMARK_URL)}" alt="" height="20">`
    : `<span>${name}</span>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>404 · ${TITLE} · ${name}</title>
<style>
@font-face { font-family: 'Brand Hero'; src: url(data:font/woff2;base64,${HERO_FONT}) format('woff2'); font-weight: 700; font-display: block; }
:root { --ink: #1d2533; --secondary: #505865; --canvas: #fafbfc; --blue: #0559ff; --action-ink: #131a25; --action-ink-pressed: #0c1119; --font-body: 'HarmonyOS Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif; --font-hero: 'Brand Hero', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif; --ease: cubic-bezier(.22, .75, .25, 1); }
* { box-sizing: border-box; margin: 0; }
body { display: flex; flex-direction: column; min-height: 100vh; min-height: 100svh; color: var(--ink); background: var(--canvas); font-family: var(--font-body); -webkit-font-smoothing: antialiased; }
header { display: flex; align-items: center; height: 72px; padding: 0 clamp(16px, 4vw, 48px); }
.brand { display: inline-flex; align-items: center; border-radius: 6px; color: inherit; font-size: 16px; font-weight: 600; text-decoration: none; }
.brand img { display: block; width: auto; }
main { display: grid; flex: 1; place-items: center; padding: 32px 24px 104px; overflow: hidden; }
.stage { position: relative; display: grid; place-items: center; width: min(1040px, 100%); min-height: min(440px, 52svh); container-type: inline-size; text-align: center; isolation: isolate; }
.numeral { --tracking: -.055em; position: absolute; top: 50%; left: 50%; z-index: -1; width: max-content; color: #e7eaee; font: 700 min(48cqi, 48svh)/.9 var(--font-hero); letter-spacing: var(--tracking); transform: translate(calc(-50% + var(--tracking) / 2), -43%); pointer-events: none; user-select: none; }
.copy { max-width: 880px; transform: translateY(-12px); }
h1 { font: 700 clamp(24px, 5vw, 48px)/1.15 var(--font-hero); letter-spacing: -.03em; text-wrap: balance; }
p { max-width: 460px; margin: 12px auto 0; color: var(--secondary); font-size: 16px; line-height: 28px; text-wrap: pretty; }
.action { display: inline-flex; align-items: center; justify-content: center; min-width: 144px; height: 48px; margin-top: 28px; padding: 0 24px; border-radius: 10px; color: #fff; background: var(--action-ink); font: 500 15px/24px var(--font-body); text-decoration: none; white-space: nowrap; transition: box-shadow 220ms var(--ease), translate 220ms var(--ease); }
.action:focus-visible, .brand:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }
@media (hover: hover) and (pointer: fine) { .action:hover { box-shadow: 0 8px 18px -6px #131a2538; } }
@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) { .action:hover { translate: 0 -2px; } }
.action:active { background: var(--action-ink-pressed); translate: none; box-shadow: 0 2px 6px -3px #131a2526; }
@media (max-width: 600px) {
  main { padding: 24px 16px 72px; }
  .stage { min-height: min(320px, 48svh); }
  h1 { font-size: 24px; line-height: 1.2; letter-spacing: -.02em; }
  p { max-width: 320px; font-size: 14px; line-height: 24px; }
  .action { margin-top: 24px; }
}
</style>
</head>
<body>
<header><a class="brand" href="/" aria-label="${name}">${brand}</a></header>
<main>
  <section class="stage" aria-labelledby="title">
    <span class="numeral" aria-hidden="true">404</span>
    <div class="copy">
      <h1 id="title">${TITLE}</h1>
      <p>${DESCRIPTION}</p>
      <a class="action" href="/">返回 ${name}</a>
    </div>
  </section>
</main>
</body>
</html>`;
};

/**
 * 404 for `/f/:id`. Browsers get the branded page; other callers (image tags,
 * download tools, AI fetchers) keep the plain-text body.
 */
export const createFileNotFoundResponse = (req: Request, init: { headers?: HeadersInit } = {}) => {
  const headers = new Headers(init.headers);
  if (!req.headers.get('accept')?.includes('text/html'))
    return new Response('File not found', { headers, status: 404 });

  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(renderPage(), { headers, status: 404 });
};
