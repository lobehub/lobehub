import { createCache } from '@ant-design/cssinjs';
import { buildInlineAntdStyle } from '@lobehub/ui/static-css/runtime';
import { extractStaticStyle, StyleProvider } from 'antd-style';
import { renderToReadableStream } from 'react-dom/server';
import type { EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';
import { styleKeys } from 'virtual:lobehub/antd-static-css';

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  let status = responseStatusCode;
  const antdCache = createCache();

  const stream = await renderToReadableStream(
    <StyleProvider cache={antdCache} speedy={false}>
      <ServerRouter context={routerContext} url={request.url} />
    </StyleProvider>,
    {
      onError(error) {
        status = 500;
        console.error(error);
      },
    },
  );

  await stream.allReady;
  const html = await new Response(stream).text();

  const inlineAntd = buildInlineAntdStyle(antdCache, { styleKeys });
  const emotionTags = extractStaticStyle(html, { includeAntd: false })
    .map((item) => item.tag)
    .join('');

  responseHeaders.set('Content-Type', 'text/html; charset=utf-8');
  responseHeaders.set('x-workbench-antd-uncovered', String(inlineAntd.uncovered.length));

  return new Response(html.replace('</head>', `${inlineAntd.html}${emotionTags}</head>`), {
    headers: responseHeaders,
    status,
  });
}
