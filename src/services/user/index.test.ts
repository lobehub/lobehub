import { describe, expect, it, vi } from 'vitest';

import { testService } from '~test-utils';

import { UserService, userService } from './index';

const mockLambdaClient = vi.hoisted(() => ({
  user: {
    getUserRegistrationDuration: { query: vi.fn() },
    getUserState: { query: vi.fn() },
    getUserSSOProviders: { query: vi.fn() },
    makeUserOnboarded: { mutate: vi.fn() },
    updateAvatar: { mutate: vi.fn() },
    updateFullName: { mutate: vi.fn() },
    updatePreference: { mutate: vi.fn() },
    updateGuide: { mutate: vi.fn() },
    updateSettings: { mutate: vi.fn() },
    resetSettings: { mutate: vi.fn() },
  },
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: mockLambdaClient,
}));

describe('UserService', () => {
  testService(UserService);

  describe('getUserRegistrationDuration', () => {
    it('should call lambdaClient.user.getUserRegistrationDuration.query', async () => {
      const mockResult = { createdAt: '2024-01-01', duration: 100, updatedAt: '2024-01-02' };
      mockLambdaClient.user.getUserRegistrationDuration.query.mockResolvedValueOnce(mockResult);

      const result = await userService.getUserRegistrationDuration();

      expect(mockLambdaClient.user.getUserRegistrationDuration.query).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });
  });

  describe('getUserState', () => {
    it('should call lambdaClient.user.getUserState.query', async () => {
      const mockState = { isOnboarded: true, preference: {}, settings: {} };
      mockLambdaClient.user.getUserState.query.mockResolvedValueOnce(mockState);

      const result = await userService.getUserState();

      expect(mockLambdaClient.user.getUserState.query).toHaveBeenCalled();
      expect(result).toEqual(mockState);
    });
  });

  describe('getUserSSOProviders', () => {
    it('should call lambdaClient.user.getUserSSOProviders.query', async () => {
      const mockProviders = [
        { provider: 'github', email: 'test@example.com', providerAccountId: '123' },
      ];
      mockLambdaClient.user.getUserSSOProviders.query.mockResolvedValueOnce(mockProviders);

      const result = await userService.getUserSSOProviders();

      expect(mockLambdaClient.user.getUserSSOProviders.query).toHaveBeenCalled();
      expect(result).toEqual(mockProviders);
    });
  });

  describe('makeUserOnboarded', () => {
    it('should call lambdaClient.user.makeUserOnboarded.mutate', async () => {
      mockLambdaClient.user.makeUserOnboarded.mutate.mockResolvedValueOnce({ success: true });

      await userService.makeUserOnboarded();

      expect(mockLambdaClient.user.makeUserOnboarded.mutate).toHaveBeenCalled();
    });
  });

  describe('updateAvatar', () => {
    it('should call lambdaClient.user.updateAvatar.mutate with avatar string', async () => {
      mockLambdaClient.user.updateAvatar.mutate.mockResolvedValueOnce({ success: true });

      await userService.updateAvatar('https://example.com/avatar.png');

      expect(mockLambdaClient.user.updateAvatar.mutate).toHaveBeenCalledWith(
        'https://example.com/avatar.png',
      );
    });
  });

  describe('updateFullName', () => {
    it('should call lambdaClient.user.updateFullName.mutate with fullName string', async () => {
      mockLambdaClient.user.updateFullName.mutate.mockResolvedValueOnce({ success: true });

      await userService.updateFullName('John Doe');

      expect(mockLambdaClient.user.updateFullName.mutate).toHaveBeenCalledWith('John Doe');
    });
  });

  describe('updatePreference', () => {
    it('should call lambdaClient.user.updatePreference.mutate with preference object', async () => {
      const preference = { hideSyncAlert: true };
      mockLambdaClient.user.updatePreference.mutate.mockResolvedValueOnce({ success: true });

      await userService.updatePreference(preference);

      expect(mockLambdaClient.user.updatePreference.mutate).toHaveBeenCalledWith(preference);
    });
  });

  describe('updateGuide', () => {
    it('should call lambdaClient.user.updateGuide.mutate with guide object', async () => {
      const guide = { moveSettingsToAvatar: true };
      mockLambdaClient.user.updateGuide.mutate.mockResolvedValueOnce({ success: true });

      await userService.updateGuide(guide);

      expect(mockLambdaClient.user.updateGuide.mutate).toHaveBeenCalledWith(guide);
    });
  });

  describe('updateUserSettings', () => {
    it('should call lambdaClient.user.updateSettings.mutate with settings', async () => {
      const settings = { general: { fontSize: 14 } };
      mockLambdaClient.user.updateSettings.mutate.mockResolvedValueOnce({ success: true });

      await userService.updateUserSettings(settings);

      expect(mockLambdaClient.user.updateSettings.mutate).toHaveBeenCalledWith(settings, {
        signal: undefined,
      });
    });

    it('should pass abort signal when provided', async () => {
      const settings = { general: { fontSize: 16 } };
      const abortController = new AbortController();
      mockLambdaClient.user.updateSettings.mutate.mockResolvedValueOnce({ success: true });

      await userService.updateUserSettings(settings, abortController.signal);

      expect(mockLambdaClient.user.updateSettings.mutate).toHaveBeenCalledWith(settings, {
        signal: abortController.signal,
      });
    });
  });

  describe('resetUserSettings', () => {
    it('should call lambdaClient.user.resetSettings.mutate', async () => {
      mockLambdaClient.user.resetSettings.mutate.mockResolvedValueOnce({ success: true });

      await userService.resetUserSettings();

      expect(mockLambdaClient.user.resetSettings.mutate).toHaveBeenCalled();
    });
  });
});
