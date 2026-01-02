// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appEnv } from '@/envs/app';

import { TelemetryContext, checkTelemetryEnabled } from './telemetry';

const mockGetUserSettings = vi.fn();

vi.mock('@/envs/app', () => ({
  appEnv: {
    TELEMETRY_DISABLED: false,
  },
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({
    getUserSettings: mockGetUserSettings,
  })),
}));

describe('checkTelemetryEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset appEnv mock
    vi.mocked(appEnv).TELEMETRY_DISABLED = false;
    // Default mock returns
    mockGetUserSettings.mockResolvedValue(null);
  });

  describe('environment variable priority (highest)', () => {
    it('should return telemetryEnabled: false when TELEMETRY_DISABLED=true', async () => {
      vi.mocked(appEnv).TELEMETRY_DISABLED = true;

      const result = await checkTelemetryEnabled({
        serverDB: {} as TelemetryContext['serverDB'],
        userId: 'test-user',
      });

      expect(result).toEqual({ telemetryEnabled: false });
      // Should not call database
      expect(mockGetUserSettings).not.toHaveBeenCalled();
    });

    it('should check database when TELEMETRY_DISABLED is false', async () => {
      await checkTelemetryEnabled({
        serverDB: {} as TelemetryContext['serverDB'],
        userId: 'test-user',
      });

      expect(mockGetUserSettings).toHaveBeenCalled();
    });

    it('should check database when TELEMETRY_DISABLED is undefined', async () => {
      vi.mocked(appEnv).TELEMETRY_DISABLED = undefined;

      await checkTelemetryEnabled({
        serverDB: {} as TelemetryContext['serverDB'],
        userId: 'test-user',
      });

      expect(mockGetUserSettings).toHaveBeenCalled();
    });
  });

  describe('user_settings.general.telemetry', () => {
    it('should return telemetryEnabled: true from settings.general', async () => {
      mockGetUserSettings.mockResolvedValue({
        general: { telemetry: true },
      });

      const result = await checkTelemetryEnabled({
        serverDB: {} as TelemetryContext['serverDB'],
        userId: 'test-user',
      });

      expect(result).toEqual({ telemetryEnabled: true });
    });

    it('should return telemetryEnabled: false from settings.general', async () => {
      mockGetUserSettings.mockResolvedValue({
        general: { telemetry: false },
      });

      const result = await checkTelemetryEnabled({
        serverDB: {} as TelemetryContext['serverDB'],
        userId: 'test-user',
      });

      expect(result).toEqual({ telemetryEnabled: false });
    });

    it('should return false when settings.general.telemetry is not set', async () => {
      mockGetUserSettings.mockResolvedValue({
        general: { fontSize: 14 }, // no telemetry field
      });

      const result = await checkTelemetryEnabled({
        serverDB: {} as TelemetryContext['serverDB'],
        userId: 'test-user',
      });

      expect(result).toEqual({ telemetryEnabled: false });
    });
  });

  describe('default value', () => {
    it('should default to false when settings is null', async () => {
      mockGetUserSettings.mockResolvedValue(null);

      const result = await checkTelemetryEnabled({
        serverDB: {} as TelemetryContext['serverDB'],
        userId: 'test-user',
      });

      expect(result).toEqual({ telemetryEnabled: false });
    });

    it('should default to false when general is null', async () => {
      mockGetUserSettings.mockResolvedValue({
        general: null,
      });

      const result = await checkTelemetryEnabled({
        serverDB: {} as TelemetryContext['serverDB'],
        userId: 'test-user',
      });

      expect(result).toEqual({ telemetryEnabled: false });
    });
  });

  describe('missing context', () => {
    it('should return telemetryEnabled: true when userId is missing', async () => {
      const result = await checkTelemetryEnabled({
        serverDB: {} as TelemetryContext['serverDB'],
        userId: null,
      });

      expect(result).toEqual({ telemetryEnabled: true });
      expect(mockGetUserSettings).not.toHaveBeenCalled();
    });

    it('should return telemetryEnabled: true when serverDB is missing', async () => {
      const result = await checkTelemetryEnabled({
        serverDB: undefined,
        userId: 'test-user',
      });

      expect(result).toEqual({ telemetryEnabled: true });
      expect(mockGetUserSettings).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should return telemetryEnabled: false when getUserSettings fails', async () => {
      mockGetUserSettings.mockRejectedValue(new Error('Database error'));

      const result = await checkTelemetryEnabled({
        serverDB: {} as TelemetryContext['serverDB'],
        userId: 'test-user',
      });

      expect(result).toEqual({ telemetryEnabled: false });
    });
  });
});
