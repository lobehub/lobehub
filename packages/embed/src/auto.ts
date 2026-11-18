/**
 * Entry of the hosted `<script>` loader (`/embed.js`). Exposes
 * `window.LobeHubEmbed.init(options)` and, when the tag carries `data-agent`,
 * mounts the launcher straight away:
 *
 *   <script src="https://app.lobehub.com/embed.js" data-agent="my-bot" async></script>
 *
 * The LobeHub origin defaults to the script's own origin.
 */
import { createLobeHubEmbed, type LobeHubEmbedOptions } from './loader';
import { isEmbedTheme } from './protocol';

declare global {
  interface Window {
    LobeHubEmbed?: {
      init: (
        options: Omit<LobeHubEmbedOptions, 'host'> & { host?: string },
      ) => ReturnType<typeof createLobeHubEmbed>;
    };
  }
}

const script = document.currentScript as HTMLScriptElement | null;
const scriptOrigin = script?.src ? new URL(script.src).origin : window.location.origin;

window.LobeHubEmbed = {
  init: (options) => createLobeHubEmbed({ ...options, host: options.host ?? scriptOrigin }),
};

const mountFromScriptTag = () => {
  const data = script?.dataset;
  if (!data?.agent) return;

  window.LobeHubEmbed!.init({
    agent: data.agent,
    buttonLabel: data.buttonLabel,
    host: data.host,
    locale: data.locale,
    open: data.open === 'true',
    position: data.position === 'left' ? 'left' : 'right',
    theme: isEmbedTheme(data.theme) ? data.theme : undefined,
  });
};

if (document.body) mountFromScriptTag();
else document.addEventListener('DOMContentLoaded', mountFromScriptTag, { once: true });
