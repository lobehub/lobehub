import { AICO_PRODUCT_VERSION } from '@lobechat/const';
import { NextResponse } from 'next/server';

export interface VersionResponseData {
  /** ISO UTC build time from CI, when available */
  builtAt: string | null;
  /** preview | canary | null when unset (local/dev) */
  channel: string | null;
  /** Full or short git commit SHA */
  gitSha: string | null;
  /** SemVer: PANACHAT_VERSION override, else Aico product version */
  version: string;
}

const resolveGitSha = (): string | null => {
  const sha = process.env.GIT_SHA || process.env.SHA;
  return sha && sha.trim() ? sha.trim() : null;
};

export const resolveVersion = (): string => {
  const override = process.env.PANACHAT_VERSION?.trim();
  return override || AICO_PRODUCT_VERSION;
};

const resolveChannel = (): string | null => {
  const channel = process.env.PANACHAT_CHANNEL?.trim();
  return channel || null;
};

const resolveBuiltAt = (): string | null => {
  const builtAt = process.env.BUILD_TIME?.trim();
  return builtAt || null;
};

export async function GET() {
  return NextResponse.json({
    version: resolveVersion(),
    gitSha: resolveGitSha(),
    channel: resolveChannel(),
    builtAt: resolveBuiltAt(),
  } satisfies VersionResponseData);
}
