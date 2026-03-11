import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { NextResponse } from 'next/server';

/**
 * just for a proxy
 */
export const POST = async (req: Request) => {
  const url = await req.text();

  try {
    const res = await ssrfSafeFetch(url);

    // Clone headers and remove Content-Encoding because fetch() automatically
    // decompresses the response body, so we should not forward this header
    const headers = new Headers(res.headers);
    headers.delete('Content-Encoding');
    headers.delete('Content-Length'); // Length changes after decompression

    return new Response(await res.arrayBuffer(), { headers });
  } catch (err) {
    console.error(err); // DNS lookup 127.0.0.1(family:4, host:127.0.0.1.nip.io) is not allowed. Because, It is private IP address.
    return NextResponse.json({ error: 'Not support internal host proxy' }, { status: 400 });
  }
};
