import debug from 'debug';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { zodValidator } from '@/app/(backend)/middleware/validate';
import {
  type DesktopDownloadType,
  getLatestDesktopReleaseFromGithub,
  getStableDesktopReleaseInfoFromUpdateServer,
  resolveDesktopDownload,
  resolveDesktopDownloadFromUrls,
} from '@/server/services/desktopRelease';

const log = debug('api-route:desktop:latest');

const SupportedTypes = ['mac-arm', 'mac-intel', 'windows', 'linux'] as const;

const truthyStringToBoolean = z.preprocess((value) => {
  if (!value) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;

  const v = value.trim().toLowerCase();
  if (!v) return undefined;

  return v === '1' || v === 'true' || v === 'yes' || v === 'y';
}, z.boolean());

const downloadTypeSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  return value;
}, z.enum(SupportedTypes));

const querySchema = z
  .object({
    asJson: truthyStringToBoolean.optional(),
    as_json: truthyStringToBoolean.optional(),
    type: downloadTypeSchema.optional(),
  })
  .strip()
  .transform((value) => ({
    asJson: value.as_json ?? value.asJson ?? false,
    type: value.type,
  }))
  .superRefine((value, ctx) => {
    if (!value.asJson && !value.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '`type` is required when `as_json` is false',
        path: ['type'],
      });
    }
  });

export const GET = zodValidator(querySchema)(async (req, _context, query) => {
  try {
    const { asJson, type } = query;

    const stableInfo = await getStableDesktopReleaseInfoFromUpdateServer();

    if (!type) {
      if (stableInfo) {
        return NextResponse.json({
          links: {
            'linux': resolveDesktopDownloadFromUrls({ ...stableInfo, type: 'linux' }),
            'mac-arm': resolveDesktopDownloadFromUrls({ ...stableInfo, type: 'mac-arm' }),
            'mac-intel': resolveDesktopDownloadFromUrls({ ...stableInfo, type: 'mac-intel' }),
            'windows': resolveDesktopDownloadFromUrls({ ...stableInfo, type: 'windows' }),
          },
          tag: stableInfo.tag,
          version: stableInfo.version,
        });
      }

      const release = await getLatestDesktopReleaseFromGithub();
      const resolveOne = (t: DesktopDownloadType) => resolveDesktopDownload(release, t);

      return NextResponse.json({
        links: {
          'linux': resolveOne('linux'),
          'mac-arm': resolveOne('mac-arm'),
          'mac-intel': resolveOne('mac-intel'),
          'windows': resolveOne('windows'),
        },
        tag: release.tag_name,
        version: release.tag_name.replace(/^v/i, ''),
      });
    }

    const s3Resolved = stableInfo ? resolveDesktopDownloadFromUrls({ ...stableInfo, type }) : null;
    if (s3Resolved) {
      if (asJson) return NextResponse.json(s3Resolved);
      return NextResponse.redirect(s3Resolved.url, { status: 302 });
    }

    const release = await getLatestDesktopReleaseFromGithub();
    const resolved = resolveDesktopDownload(release, type);
    if (!resolved) {
      return NextResponse.json(
        { error: 'No matched asset for type', supportedTypes: SupportedTypes, type },
        { status: 404 },
      );
    }

    if (asJson) return NextResponse.json(resolved);

    return NextResponse.redirect(resolved.url, { status: 302 });
  } catch (e) {
    log('Failed to resolve latest desktop download: %O', e);
    return NextResponse.json(
      { error: 'Failed to resolve latest desktop download' },
      { status: 500 },
    );
  }
});
