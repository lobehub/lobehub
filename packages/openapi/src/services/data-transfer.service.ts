import { nanoid } from '@lobechat/utils';
import { TRPCError } from '@trpc/server';

import { FileModel } from '@/database/models/file';
import type { LobeChatDatabase } from '@/database/type';
import { fileEnv } from '@/envs/file';
import { exporterRouter } from '@/server/routers/lambda/exporter';
import { importerRouter } from '@/server/routers/lambda/importer';
import { FileService } from '@/server/services/file';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import type {
  CreateExportRequest,
  CreateImportRequest,
  ExportResult,
  ImportResult,
} from '../types/data-transfer.type';

/** How long a download link stays valid. */
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

/**
 * How long a stored export is kept. A JSON dump carries the account's stored
 * credentials, so it is a short-lived download, not an archive: expired dumps
 * answer 404 and are deleted on the next read or export.
 */
const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** `exp_<creation time in base36>_<random>`, so retention needs no metadata lookup. */
const newExportId = () => `exp_${Date.now().toString(36)}_${nanoid(16)}`;

const exportCreatedAt = (id: string) => {
  const created = Number.parseInt(id.split('_')[1] ?? '', 36);
  return Number.isFinite(created) ? created : undefined;
};

const isExpired = (id: string, now = Date.now()) => {
  const created = exportCreatedAt(id);
  return created === undefined || now - created > EXPORT_RETENTION_MS;
};

/** Object storage answered with an error: logged, and reported as a dependency outage. */
const storageUnavailable = (error: unknown, operation: string) => {
  console.error(`[DataTransferService] ${operation} failed in object storage:`, error);
  return new ApiException(503, 'service_unavailable', `File storage failed to ${operation}`);
};

/** HeadObject on a missing key — every other storage error is a real failure. */
const isMissingObject = (error: unknown) => {
  const candidate = error as { $metadata?: { httpStatusCode?: number }; name?: string };
  return candidate?.name === 'NotFound' || candidate?.$metadata?.httpStatusCode === 404;
};

const EXTENSIONS = { json: 'json', pdf: 'pdf' } as const;
type ExportFormat = keyof typeof EXTENSIONS;

const CONTENT_TYPES: Record<ExportFormat, string> = {
  json: 'application/json',
  pdf: 'application/pdf',
};

/** A file name that survives every OS: no path separators or control characters. */
const UNSAFE_FILE_NAME_CHARS = new Set('"*/:<>?\\|');
const safeFileName = (value: string) =>
  [...value]
    .map((char) => (char.charCodeAt(0) < 32 || UNSAFE_FILE_NAME_CHARS.has(char) ? '_' : char))
    .join('')
    .trim() || 'export';

type ImportCounts = ImportResult['results'][string];

const isCounts = (value: unknown): value is ImportCounts =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as ImportCounts).added === 'number' &&
  typeof (value as ImportCounts).skips === 'number' &&
  typeof (value as ImportCounts).errors === 'number';

/**
 * Account / workspace data export and import for the REST API.
 *
 * The dump itself and the import are the tRPC `exporter` / `importer`
 * procedures, called server-side so their guards apply unchanged — in cloud a
 * workspace export or import is reserved for the workspace's owner. This layer
 * stores the result in object storage and hands out signed download links.
 *
 * An export is a storage object under a key derived from the caller and the
 * workspace (`exports/<userId>/<workspace|personal>/<id>.<ext>`), so an id is
 * only ever resolved inside its owner's prefix: another user, or the same user
 * in another workspace, gets a 404.
 */
export class DataTransferService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string };

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId };
  }

  /** Server guards throw `TRPCError`; the controller maps its code to the HTTP status. */
  private fail(error: unknown, operation: string): never {
    if (error instanceof TRPCError) throw error;
    this.handleServiceError(error, operation);
  }

  private get fileService() {
    return new FileService(this.db, this.userId, this.workspaceId);
  }

  private assertStorage() {
    if (!fileEnv.S3_BUCKET) {
      throw new ApiException(
        503,
        'service_unavailable',
        'File storage is not configured on this server, so exports cannot be stored',
      );
    }
  }

  private exportKey(id: string, format: ExportFormat) {
    return `exports/${this.userId}/${this.workspaceId ?? 'personal'}/${id}.${EXTENSIONS[format]}`;
  }

  /**
   * Delete the caller's expired exports in every scope (one listing page per
   * call, so the sweep stays bounded). Best effort: a failed sweep must not
   * fail the export that triggered it, and the next call retries.
   */
  private async sweepExpiredExports() {
    try {
      const keys = await this.fileService.listFileKeys(`exports/${this.userId}/`);
      const now = Date.now();
      const expired = keys.filter((key) => {
        const id = key
          .split('/')
          .at(-1)
          ?.replace(/\.[^.]+$/, '');
        return !!id && isExpired(id, now);
      });
      if (expired.length > 0) await this.fileService.deleteFiles(expired);
    } catch (error) {
      console.error('[DataTransferService] Failed to sweep expired exports:', error);
    }
  }

  private async describeExport(
    id: string,
    format: ExportFormat,
    filename: string,
    size: number,
  ): Promise<ExportResult> {
    // The link never outlives the stored file: refreshing it during the last
    // hour of retention must not sign a URL that stays valid after the dump is
    // gone, so the signed lifetime is clamped to what is left, not only the
    // reported `expiresAt`.
    const expiresAt = Math.min(
      Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000,
      (exportCreatedAt(id) ?? Date.now()) + EXPORT_RETENTION_MS,
    );

    const downloadUrl = await this.fileService.createDownloadUrl(
      this.exportKey(id, format),
      filename,
      // Rounded down, and at least a second so the link is usable at the edge.
      Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
    );

    return {
      downloadUrl,
      expiresAt: new Date(expiresAt).toISOString(),
      filename,
      format,
      id,
      size,
      status: 'completed',
    };
  }

  async createExport(request: CreateExportRequest): Promise<ExportResult> {
    this.assertStorage();

    try {
      const exporter = exporterRouter.createCaller(this.ctx);
      const id = newExportId();

      let buffer: Buffer;
      let filename: string;

      if (request.format === 'json') {
        const dump = await exporter.exportData();
        buffer = Buffer.from(JSON.stringify(dump));
        filename = `lobehub-export-${id}.json`;
      } else {
        // `sessionId` is part of the tRPC input but unused by the renderer.
        const { pdf } = await exporter.exportPdf({
          content: request.content,
          sessionId: '',
          title: request.title,
        });
        buffer = Buffer.from(pdf, 'base64');
        filename = `${safeFileName(request.title ?? 'export')}.pdf`;
      }

      // Private even when `S3_SET_ACL` makes uploads public-read: the dump must
      // only be reachable through the signed link below.
      await this.fileService.uploadBuffer(
        this.exportKey(id, request.format),
        buffer,
        CONTENT_TYPES[request.format],
        { private: true },
      );
      await this.sweepExpiredExports();

      return await this.describeExport(id, request.format, filename, buffer.length);
    } catch (error) {
      this.fail(error, 'Create export');
    }
  }

  async getExport(id: string): Promise<ExportResult> {
    this.assertStorage();

    if (isExpired(id)) {
      await this.sweepExpiredExports();
      throw this.createNotFoundError('Export not found');
    }

    for (const format of Object.keys(EXTENSIONS) as ExportFormat[]) {
      let size: number;
      try {
        ({ contentLength: size } = await this.fileService.getFileMetadata(
          this.exportKey(id, format),
        ));
      } catch (error) {
        if (isMissingObject(error)) continue;
        throw storageUnavailable(error, 'read the export');
      }

      return this.describeExport(id, format, `lobehub-export-${id}.${EXTENSIONS[format]}`, size);
    }

    throw this.createNotFoundError('Export not found');
  }

  async createImport(request: CreateImportRequest): Promise<ImportResult> {
    try {
      const importer = importerRouter.createCaller(this.ctx);

      let result;
      if (request.source === 'export') {
        const { data, mode, schemaHash } = request;
        result = await importer.importPgByPost({ data, mode, schemaHash });
      } else if (request.source === 'legacy') {
        result = await importer.importByPost({ data: request.data });
      } else {
        result = await this.importFile(importer, request.fileId);
      }

      if (!result.success) {
        throw new ApiException(
          422,
          'unprocessable_entity',
          result.error.details
            ? `${result.error.message}: ${result.error.details}`
            : result.error.message,
        );
      }

      return {
        results: Object.fromEntries(
          Object.entries(result.results ?? {}).filter(([, value]) => isCounts(value)),
        ) as ImportResult['results'],
      };
    } catch (error) {
      this.fail(error, 'Import data');
    }
  }

  /**
   * Read the dump from one of the caller's own files. Unlike the in-app
   * `importByFile` (which consumes a throwaway upload), the file is left in
   * place: it is an ordinary file of the caller's library.
   */
  private async importFile(
    importer: ReturnType<typeof importerRouter.createCaller>,
    fileId: string,
  ) {
    const file = await new FileModel(this.db, this.userId, this.workspaceId).findById(fileId);
    if (!file) throw this.createNotFoundError('File not found');

    const fileService = this.fileService;
    const key = /^https?:\/\//.test(file.url)
      ? await fileService.getKeyFromFullUrl(file.url)
      : file.url;

    // Storage failures propagate as such; only unparsable content is a 400.
    let content: string;
    try {
      content = await fileService.getFileContent(key ?? file.url);
    } catch (error) {
      throw storageUnavailable(error, 'read the file');
    }

    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      throw this.createValidationError('The file is not a JSON export');
    }

    if (!data || typeof data !== 'object') {
      throw this.createValidationError('The file is not a JSON export');
    }

    if ('schemaHash' in data && 'data' in data) {
      const dump = data as { data: Record<string, object[]>; schemaHash: string };
      return importer.importPgByPost({
        data: dump.data,
        mode: 'postgres',
        schemaHash: dump.schemaHash,
      });
    }

    if ('version' in data) {
      return importer.importByPost({ data: data as { version: number } });
    }

    throw this.createValidationError('The file is not a JSON export');
  }
}
