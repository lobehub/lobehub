import { stat } from 'node:fs/promises';

import { app as electronApp, dialog } from 'electron';

import {
  channelFromScheme,
  removeDiscoveryFile,
  removeDiscoveryFileSync,
  writeDiscoveryFile,
} from '@/modules/appHandoff/discoveryFile';
import { findListener, findPeerProcess } from '@/modules/appHandoff/peerProcess';
import {
  APP_HANDOFF_CONFIRM_TIMEOUT_MS,
  APP_HANDOFF_DEEP_LINK,
  type AppHandoffChannel,
} from '@/modules/appHandoff/protocol';
import { type AppHandoffServer, startAppHandoffServer } from '@/modules/appHandoff/server';
import {
  AppHandoffService,
  type ConfirmRequest,
  type DesktopSession,
  issuerFor,
} from '@/modules/appHandoff/service';
import { desktopSessionEvents } from '@/modules/appHandoff/sessionEvents';
import { verifyExecutable } from '@/modules/appHandoff/verifyExecutable';
import type { AppHandoffTrustedApp } from '@/types/store';
import { createLogger } from '@/utils/logger';
import { netFetch } from '@/utils/net-fetch';
import { getProtocolScheme } from '@/utils/protocol';
import { getDesktopUserAgent } from '@/utils/user-agent';

import { ControllerModule, createProtocolHandler } from './index';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';

const logger = createLogger('controllers:AppHandoffCtr');

const protocolHandler = createProtocolHandler(APP_HANDOFF_DEEP_LINK.urlType);

/** Refresh the desktop token before asking for a code when it has less than this left. */
const TOKEN_FRESHNESS_MS = 5 * 60 * 1000;

/**
 * Local sign-in handoff for other native apps (see `modules/appHandoff/protocol.ts`).
 *
 * While the desktop app is signed in and its server lists at least one handoff
 * target, it listens on `127.0.0.1:<random port>` and publishes the port in
 * `~/.lobehub/desktop-handoff/<channel>.json`. It stops listening and removes
 * the file on sign-out, on a server switch and on quit.
 */
export default class AppHandoffCtr extends ControllerModule {
  static override readonly groupName = 'appHandoff';

  private server?: AppHandoffServer;
  private published?: { channel: AppHandoffChannel; issuer: string };
  private syncing: Promise<void> = Promise.resolve();
  private syncQueued = false;

  private readonly service = new AppHandoffService({
    confirm: (request) => this.confirm(request),
    fetch: (input, init) => netFetch(input, init),
    findListener: (port) => findListener(port),
    findPeer: (serverPort, remotePort) => findPeerProcess(serverPort, remotePort),
    getSession: (options) => this.getSession(options),
    isTrusted: (clientId, exePath) => this.isTrusted(clientId, exePath),
    log: logger,
    trust: (clientId, exePath) => this.trust(clientId, exePath),
    userAgent: getDesktopUserAgent(),
    verifyExecutable: (exePath, verification) => verifyExecutable(exePath, verification),
  });

  private get remoteServerConfigCtr() {
    return this.app.getController(RemoteServerConfigCtr);
  }

  afterAppReady() {
    desktopSessionEvents.on('changed', () => this.scheduleSync());
    electronApp.on('will-quit', () => this.stopOnQuit());
    this.scheduleSync();
  }

  @protocolHandler(APP_HANDOFF_DEEP_LINK.action)
  async handleDeepLink(params: Record<string, string>) {
    return this.service.deepLink(params);
  }

  /** Coalesces bursts of session changes (every token refresh emits one) into one sync. */
  private scheduleSync() {
    if (this.syncQueued) return;
    this.syncQueued = true;
    this.syncing = this.syncing
      .then(async () => {
        this.syncQueued = false;
        await this.sync();
      })
      .catch((error) => logger.warn('[AppHandoff] sync failed', error));
  }

  private async sync() {
    const session = await this.getSession({ refresh: false });
    if (!session) {
      this.service.reset();
      await this.stop();
      return;
    }

    const issuer = issuerFor(session.serverUrl);
    if (this.published && this.published.issuer !== issuer) {
      this.service.reset();
      await this.stop();
    }

    const targets = await this.service.loadTargets(session).catch((error) => {
      logger.info('[AppHandoff] handoff not available on this server', error?.message);
      return null;
    });
    if (!targets || targets.targets.length === 0) {
      await this.stop();
      return;
    }

    await this.start(issuer);
  }

  private async start(issuer: string) {
    if (this.server && this.published?.issuer === issuer) return;

    if (!this.server) {
      const server = await startAppHandoffServer(
        (request) => this.service.handle(request, server.port),
        { onError: (error) => logger.error('[AppHandoff] request failed', error) },
      );
      this.server = server;
    }

    const channel = channelFromScheme(getProtocolScheme());
    await writeDiscoveryFile({ channel, issuer, pid: process.pid, port: this.server.port });
    this.published = { channel, issuer };
    logger.info(`[AppHandoff] listening on 127.0.0.1:${this.server.port} for ${issuer}`);
  }

  private async stop() {
    const { published, server } = this;
    this.published = undefined;
    this.server = undefined;
    if (published) await removeDiscoveryFile(published.channel).catch(() => false);
    if (server) {
      await server.close();
      logger.info('[AppHandoff] stopped listening');
    }
  }

  /** Quit cannot wait for promises: remove the file synchronously, then let the socket die with the process. */
  stopOnQuit() {
    const { published, server } = this;
    this.published = undefined;
    this.server = undefined;
    if (published) removeDiscoveryFileSync(published.channel);
    void server?.close();
  }

  private async getSession({ refresh = false } = {}): Promise<DesktopSession | null> {
    const ctr = this.remoteServerConfigCtr;
    const config = await ctr.getRemoteServerConfig();
    if (!(await ctr.isRemoteServerConfigured(config))) return null;

    const serverUrl = await ctr.getRemoteServerUrl(config);
    if (!serverUrl) return null;

    // Goes through the app's own single-flight refresh, so a handoff never adds
    // a second, competing rotation of the desktop refresh token.
    if (refresh && ctr.isTokenExpiringSoon(TOKEN_FRESHNESS_MS)) {
      await ctr.refreshAccessToken();
    }
    const accessToken = await ctr.getAccessToken();
    return accessToken ? { accessToken, serverUrl } : null;
  }

  private async confirm(request: ConfirmRequest) {
    const t = this.app.i18n.ns('dialog');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), APP_HANDOFF_CONFIRM_TIMEOUT_MS);
    electronApp.focus({ steal: true });

    try {
      const window = this.app.browserManager.getMainWindow()?.browserWindow;
      const options: Electron.MessageBoxOptions = {
        buttons: [t('appHandoff.allow'), t('appHandoff.deny')],
        cancelId: 1,
        checkboxLabel: request.rememberable ? t('appHandoff.remember') : undefined,
        defaultId: 1,
        detail: [
          request.exePath
            ? t('appHandoff.program', { path: request.exePath })
            : t('appHandoff.unknownProgram'),
          t('appHandoff.detail'),
        ].join('\n\n'),
        message: t('appHandoff.message', { name: request.appName }),
        signal: controller.signal,
        title: t('appHandoff.title'),
        type: 'question',
      };
      const result = window
        ? await dialog.showMessageBox(window, options)
        : await dialog.showMessageBox(options);
      return { allowed: result.response === 0, remember: result.checkboxChecked };
    } catch {
      return { allowed: false, remember: false };
    } finally {
      clearTimeout(timer);
    }
  }

  private async fileIdentity(exePath: string) {
    const info = await stat(exePath);
    return { mtimeMs: Math.floor(info.mtimeMs), size: info.size };
  }

  private async isTrusted(clientId: string, exePath: string) {
    const trusted = this.app.storeManager.get('appHandoffTrustedApps') ?? [];
    const entry = trusted.find((item) => item.clientId === clientId && item.exePath === exePath);
    if (!entry) return false;
    try {
      const identity = await this.fileIdentity(exePath);
      return identity.size === entry.size && identity.mtimeMs === entry.mtimeMs;
    } catch {
      return false;
    }
  }

  private async trust(clientId: string, exePath: string) {
    const identity = await this.fileIdentity(exePath);
    const trusted = (this.app.storeManager.get('appHandoffTrustedApps') ?? []).filter(
      (item) => !(item.clientId === clientId && item.exePath === exePath),
    );
    const entry: AppHandoffTrustedApp = { clientId, exePath, ...identity };
    this.app.storeManager.set('appHandoffTrustedApps', [...trusted, entry]);
  }
}
