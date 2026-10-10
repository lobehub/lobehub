import { extractStaticStyle } from '@lobehub/ui';
import { renderToReadableStream } from 'react-dom/server';
import type { EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  let status = responseStatusCode;

  const stream = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error) {
        status = 500;
        console.error(error);
      },
    },
  );

  await stream.allReady;
  const html = await new Response(stream).text();

  const emotionTags = extractStaticStyle(html)
    .map((item) => item.tag)
    .join('');

  responseHeaders.set('Content-Type', 'text/html; charset=utf-8');

  return new Response(html.replace('</head>', `${emotionTags}</head>`), {
    headers: responseHeaders,
    status,
  });
}
