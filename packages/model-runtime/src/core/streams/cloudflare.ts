import { desensitizeUrl } from '../../utils/desensitizeUrl';

class CloudflareStreamTransformer {
  private textDecoder = new TextDecoder();
  private buffer: string = '';

  private parseChunk(chunk: string, controller: TransformStreamDefaultController) {
    const dataPrefix = /^data: /;
    const json = chunk.replace(dataPrefix, '');
    const parsedChunk = JSON.parse(json);
    const res = parsedChunk?.response;
    if (!res) return; // TODO: Add test; Handle tool_call parameter.
    controller.enqueue(`event: text\n`);
    controller.enqueue(`data: ${JSON.stringify(parsedChunk.response)}\n\n`);
  }

  public async transform(chunk: Uint8Array, controller: TransformStreamDefaultController) {
    let textChunk = this.textDecoder.decode(chunk);
    if (this.buffer.trim() !== '') {
      textChunk = this.buffer + textChunk;
      this.buffer = '';
    }
    const splits = textChunk.split('\n\n');
    for (let i = 0; i < splits.length - 1; i++) {
      if (/\[DONE]/.test(splits[i].trim())) {
        return;
      }
      this.parseChunk(splits[i], controller);
    }
    const lastChunk = splits.at(-1)!;
    if (lastChunk.trim() !== '') {
      this.buffer += lastChunk; // does not need to be trimmed.
    } // else drop.
  }
}

const DEFAULT_BASE_URL_PREFIX = 'https://api.cloudflare.com';

function fillUrl(accountID: string): string {
  return `${DEFAULT_BASE_URL_PREFIX}/client/v4/accounts/${accountID}/ai/run/`;
}

function desensitizeAccountId(path: string): string {
  return path.replace(/\/[\da-f]{32}\//i, '/****/');
}

function desensitizeCloudflareUrl(url: string): string {
  const urlObj = new URL(url);
  let { protocol, hostname, port, pathname, search } = urlObj;
  if (url.startsWith(DEFAULT_BASE_URL_PREFIX)) {
    return `${protocol}//${hostname}${port ? `:${port}` : ''}${desensitizeAccountId(pathname)}${search}`;
  } else {
    const desensitizedUrl = desensitizeUrl(`${protocol}//${hostname}${port ? `:${port}` : ''}`);
    if (desensitizedUrl.endsWith('/') && pathname.startsWith('/')) {
      pathname = pathname.slice(1);
    }
    return `${desensitizedUrl}${desensitizeAccountId(pathname)}${search}`;
  }
}

export { CloudflareStreamTransformer, DEFAULT_BASE_URL_PREFIX, desensitizeCloudflareUrl, fillUrl };
