import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { DataTransferService } from '../services/data-transfer.service';
import type {
  CreateExportRequest,
  CreateImportRequest,
  ExportIdParam,
} from '../types/data-transfer.type';

/** Account / workspace data export and import. */
export class DataTransferController extends BaseController {
  private async service(c: Context): Promise<DataTransferService> {
    return new DataTransferService(
      await this.getDatabase(),
      this.getUserId(c),
      this.getWorkspaceId(c),
    );
  }

  /** POST /api/v1/exports */
  async createExport(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateExportRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.createExport(body), 'Export ready', 202);
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** GET /api/v1/exports/:id */
  async getExport(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<ExportIdParam>(c);
      const service = await this.service(c);
      return this.success(c, await service.getExport(id));
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /** POST /api/v1/imports */
  async createImport(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateImportRequest>(c);
      const service = await this.service(c);
      return this.success(c, await service.createImport(body), 'Import finished');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
