import urlJoin from 'url-join';
import { parse } from 'yaml';

import { FetchCacheTag } from '@/const/cacheControl';

export type DesktopDownloadType = 'linux' | 'mac-arm' | 'mac-intel' | 'windows';

export interface DesktopDownloadInfo {
  assetName: string;
  publishedAt?: string;
  tag: string;
  type: DesktopDownloadType;
  url: string;
  version: string;
}

type GithubReleaseAsset = {
  browser_download_url: string;
  name: string;
};

type GithubRelease = {
  assets: GithubReleaseAsset[];
  published_at?: string;
  tag_name: string;
};

type UpdateServerManifestFile = {
  url: string;
};

type UpdateServerManifest = {
  files?: UpdateServerManifestFile[];
  path?: string;
  releaseDate?: string;
  version?: string;
};

const getBasename = (pathname: string) => {
  const cleaned = pathname.split('?')[0] || '';
  const lastSlash = cleaned.lastIndexOf('/');
  return lastSlash >= 0 ? cleaned.slice(lastSlash + 1) : cleaned;
};

const isAbsoluteUrl = (value: string) => /^https?:\/\//i.test(value);

const buildTypeMatchers = (type: DesktopDownloadType) => {
  switch (type) {
    case 'mac-arm': {
      return [/-arm64\.dmg$/i, /-arm64-mac\.zip$/i, /-arm64\.zip$/i, /\.dmg$/i, /\.zip$/i];
    }
    case 'mac-intel': {
      return [/-x64\.dmg$/i, /-x64-mac\.zip$/i, /-x64\.zip$/i, /\.dmg$/i, /\.zip$/i];
    }
    case 'windows': {
      return [/-setup\.exe$/i, /\.exe$/i];
    }
    case 'linux': {
      return [/\.appimage$/i, /\.deb$/i, /\.rpm$/i, /\.snap$/i, /\.tar\.gz$/i];
    }
  }
};

export const resolveDesktopDownloadFromUrls = (options: {
  publishedAt?: string;
  tag: string;
  type: DesktopDownloadType;
  urls: string[];
  version: string;
}): DesktopDownloadInfo | null => {
  const matchers = buildTypeMatchers(options.type);

  const matchedUrl = matchers
    .map((matcher) => options.urls.find((url) => matcher.test(getBasename(url))))
    .find(Boolean);

  if (!matchedUrl) return null;

  return {
    assetName: getBasename(matchedUrl),
    publishedAt: options.publishedAt,
    tag: options.tag,
    type: options.type,
    url: matchedUrl,
    version: options.version,
  };
};

export const resolveDesktopDownload = (
  release: GithubRelease,
  type: DesktopDownloadType,
): DesktopDownloadInfo | null => {
  const tag = release.tag_name;
  const version = tag.replace(/^v/i, '');
  const matchers = buildTypeMatchers(type);

  const matchedAsset = matchers
    .map((matcher) => release.assets.find((asset) => matcher.test(asset.name)))
    .find(Boolean);

  if (!matchedAsset) return null;

  return {
    assetName: matchedAsset.name,
    publishedAt: release.published_at,
    tag,
    type,
    url: matchedAsset.browser_download_url,
    version,
  };
};

export const getLatestDesktopReleaseFromGithub = async (options?: {
  owner?: string;
  repo?: string;
  token?: string;
}): Promise<GithubRelease> => {
  const owner = options?.owner || 'lobehub';
  const repo = options?.repo || 'lobe-chat';
  const token = options?.token || process.env.GITHUB_TOKEN;

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'lobehub-server',
    },
    next: { revalidate: 300, tags: [FetchCacheTag.DesktopRelease] },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub releases/latest request failed: ${res.status} ${text}`.trim());
  }

  return (await res.json()) as GithubRelease;
};

const fetchUpdateServerManifest = async (
  baseUrl: string,
  manifestName: string,
): Promise<UpdateServerManifest> => {
  const res = await fetch(urlJoin(baseUrl, manifestName), {
    next: { revalidate: 300, tags: [FetchCacheTag.DesktopRelease] },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Update server manifest request failed: ${res.status} ${text}`.trim());
  }

  const text = await res.text();
  return (parse(text) || {}) as UpdateServerManifest;
};

const normalizeManifestUrls = (baseUrl: string, manifest: UpdateServerManifest) => {
  const urls: string[] = [];

  for (const file of manifest.files || []) {
    if (!file?.url) continue;
    urls.push(isAbsoluteUrl(file.url) ? file.url : urlJoin(baseUrl, file.url));
  }

  if (manifest.path) {
    urls.push(isAbsoluteUrl(manifest.path) ? manifest.path : urlJoin(baseUrl, manifest.path));
  }

  return urls;
};

export const getStableDesktopReleaseInfoFromUpdateServer = async (options?: {
  baseUrl?: string;
}): Promise<{ publishedAt?: string; tag: string; urls: string[]; version: string } | null> => {
  const baseUrl =
    options?.baseUrl || process.env.DESKTOP_UPDATE_SERVER_URL || process.env.UPDATE_SERVER_URL;
  if (!baseUrl) return null;

  const [mac, win, linux] = await Promise.all([
    fetchUpdateServerManifest(baseUrl, 'stable-mac.yml').catch(() => null),
    fetchUpdateServerManifest(baseUrl, 'stable.yml').catch(() => null),
    fetchUpdateServerManifest(baseUrl, 'stable-linux.yml').catch(() => null),
  ]);

  const manifests = [mac, win, linux].filter(Boolean) as UpdateServerManifest[];
  const version = manifests.map((m) => m.version).find(Boolean) || '';
  if (!version) return null;

  const tag = `v${version.replace(/^v/i, '')}`;
  const publishedAt = manifests.map((m) => m.releaseDate).find(Boolean);

  const urls = [
    ...(mac ? normalizeManifestUrls(baseUrl, mac) : []),
    ...(win ? normalizeManifestUrls(baseUrl, win) : []),
    ...(linux ? normalizeManifestUrls(baseUrl, linux) : []),
  ];

  return { publishedAt, tag, urls, version: version.replace(/^v/i, '') };
};

export const resolveDesktopDownloadFromUpdateServer = async (options: {
  baseUrl?: string;
  type: DesktopDownloadType;
}): Promise<DesktopDownloadInfo | null> => {
  const info = await getStableDesktopReleaseInfoFromUpdateServer({ baseUrl: options.baseUrl });
  if (!info) return null;

  return resolveDesktopDownloadFromUrls({ ...info, type: options.type });
};
