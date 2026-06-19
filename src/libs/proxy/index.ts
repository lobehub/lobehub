import { ProxyAgent, setGlobalDispatcher } from 'undici';

const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;

const noProxy = process.env.NO_PROXY || process.env.no_proxy;

if (proxyUrl) {
  const opts: { uri: string; noProxy?: string } = { uri: proxyUrl };

  if (noProxy) {
    opts.noProxy = noProxy;
  }

  setGlobalDispatcher(new ProxyAgent(opts));
}
