import { isDesktop } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { serialize } from 'cookie';
import debug from 'debug';
import { z } from 'zod';

import { marketProcedure } from './procedures';

const log = debug('lambda-router:market');

export const clientProcedures = {
  registerClientInMarketplace: marketProcedure.input(z.object({})).mutation(async ({ ctx }) => {
    return ctx.discoverService.registerClient({
      userAgent: ctx.userAgent,
    });
  }),
  registerM2MToken: marketProcedure
    .input(
      z.object({
        clientId: z.string(),
        clientSecret: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('registerM2MToken input: %O', { clientId: input.clientId, clientSecret: '[HIDDEN]' });

      try {
        const { accessToken, expiresIn } = await ctx.discoverService.fetchM2MToken(input);

        // check accessToken
        if (!accessToken) {
          // clean Cookies

          ctx.resHeaders?.append('Set-Cookie', serialize('mp_token_status', '', { maxAge: -1 }));
          ctx.resHeaders?.append('Set-Cookie', serialize('mp_token', '', { maxAge: -1 }));

          return { success: false };
        }

        log('get access token, expiresIn value:', expiresIn);
        log('expiresIn type:', typeof expiresIn);

        const expirationTime = new Date(Date.now() + (expiresIn - 60) * 1000); // Expire 60 seconds early

        log('expirationTime:', expirationTime.toISOString());

        // Set HTTP-Only Cookie to store the actual access token
        const tokenCookie = serialize('mp_token', accessToken, {
          expires: expirationTime,
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        });

        // Set client-readable status marker cookie (without actual token)
        const statusCookie = serialize('mp_token_status', 'active', {
          expires: expirationTime,
          httpOnly: false,
          path: '/',
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        });

        // Set Set-Cookie header via context's resHeaders
        ctx.resHeaders?.append('Set-Cookie', tokenCookie);
        ctx.resHeaders?.append('Set-Cookie', statusCookie);

        return {
          expiresIn: expiresIn - 60,
          success: true,
        };
      } catch (error) {
        console.error('Error fetching M2M token: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch M2M token',
        });
      }
    }),
  reportAgentEvent: marketProcedure
    .input(
      z.object({
        event: z.enum(['add', 'chat', 'click']),
        identifier: z.string(),
        source: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('createAgentEvent input: %O', input);

      try {
        await ctx.discoverService.createAgentEvent(input);
        return { success: true };
      } catch (error) {
        console.error('Error reporting Agent event: %O', error);
        return { success: false };
      }
    }),
  reportAgentInstall: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('reportAgentInstall input: %O', input);
      try {
        await ctx.discoverService.increaseAgentInstallCount(input.identifier);
        return { success: true };
      } catch (error) {
        log('Error reporting agent installation: %O', error);
        return { success: false };
      }
    }),
  // ============================== Analytics ==============================
  reportCall: marketProcedure
    .input(
      z.object({
        callDurationMs: z.number(),
        clientId: z.string().optional(),
        customPluginInfo: z.any().optional(),
        errorCode: z.string().optional(),
        errorMessage: z.string().optional(),
        identifier: z.string(),
        isCustomPlugin: z.boolean().optional(),
        metadata: z.record(z.string(), z.any()).optional(),
        methodName: z.string(),
        methodType: z.enum(['tool', 'prompt', 'resource']),
        platform: z.string().optional(),
        requestSizeBytes: z.number().optional(),
        responseSizeBytes: z.number().optional(),
        sessionId: z.string().optional(),
        success: z.boolean(),
        traceId: z.string().optional(),
        userAgent: z.string().optional(),
        version: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('reportCall input: %O', input);
      try {
        await ctx.discoverService.reportCall({
          ...input,
          platform: isDesktop ? process.platform : 'web',
          userAgent: ctx.userAgent,
        });
        return { success: true };
      } catch (error) {
        console.error('Error reporting call: %O', error);
        // Don't throw error, as reporting failure should not affect main flow
        return { success: false };
      }
    }),
  reportGroupAgentEvent: marketProcedure
    .input(
      z.object({
        event: z.enum(['add', 'chat', 'click']),
        identifier: z.string(),
        source: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('reportGroupAgentEvent input: %O', input);

      try {
        await ctx.discoverService.createGroupAgentEvent(input);
        return { success: true };
      } catch (error) {
        console.error('Error reporting Group Agent event: %O', error);
        return { success: false };
      }
    }),
  reportGroupAgentInstall: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('reportGroupAgentInstall input: %O', input);
      try {
        await ctx.discoverService.increaseGroupAgentInstallCount(input.identifier);
        return { success: true };
      } catch (error) {
        log('Error reporting group agent installation: %O', error);
        return { success: false };
      }
    }),
  reportMcpEvent: marketProcedure
    .input(
      z.object({
        event: z.enum(['click', 'install', 'activate', 'uninstall']),
        identifier: z.string(),
        source: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('createMcpEvent input: %O', input);

      try {
        await ctx.discoverService.createPluginEvent(input);
        return { success: true };
      } catch (error) {
        console.error('Error reporting MCP event: %O', error);
        return { success: false };
      }
    }),
  reportMcpInstallResult: marketProcedure
    .input(
      z.object({
        errorCode: z.any().optional(),
        errorMessage: z.any().optional(),
        identifier: z.string(),
        installDurationMs: z.number().optional(),
        installParams: z.any().optional(),
        manifest: z.any().optional(),
        metadata: z.any().optional(),
        platform: z.string().optional(),
        success: z.boolean(),
        userAgent: z.string().optional(),
        version: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('reportMcpInstallResult input: %O', input);
      try {
        await ctx.discoverService.reportPluginInstallation(input);
        return { success: true };
      } catch (error) {
        log('Error reporting MCP installation result: %O', error);
        // Don't throw error, as reporting failure should not affect main flow
        return { success: false };
      }
    }),
  submitFeedback: marketProcedure
    .input(
      z.object({
        clientInfo: z
          .object({
            language: z.string().optional(),
            timezone: z.string().optional(),
            url: z.string().optional(),
            userAgent: z.string().optional(),
          })
          .optional(),
        email: z.string().optional(),
        message: z.string(),
        screenshotUrl: z.string().optional(),
        title: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('submitFeedback input: %O', input);

      try {
        const result = await ctx.marketService.submitFeedback(input);
        return { issueUrl: result?.issueUrl, success: true };
      } catch (error) {
        console.error('Error submitting feedback: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to submit feedback',
        });
      }
    }),
};
