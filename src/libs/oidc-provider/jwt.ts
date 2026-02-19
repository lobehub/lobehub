import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { authEnv } from '@/envs/auth';

const log = debug('oidc-jwt');

/**
 * Get JWKS key string from environment
 * Uses JWKS_KEY which already has fallback to OIDC_JWKS_KEY in authEnv
 */
const getJwksKeyString = () => {
  return authEnv.JWKS_KEY;
};

/**
 * Get JWKS from environment variables
 * This JWKS is a JSON object containing RS256 private keys
 */
export const getJWKS = (): object => {
  try {
    const jwksString = getJwksKeyString();

    if (!jwksString) {
      throw new Error(
        'JWKS_KEY 环境变量是必需的。请使用 scripts/generate-oidc-jwk.mjs 生成 JWKS。',
      );
    }

    // Attempt to parse JWKS JSON string
    const jwks = JSON.parse(jwksString);

    // Check if JWKS format is valid
    if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new Error('JWKS 格式无效: 缺少或为空的 keys 数组');
    }

    // Check if there is an RS256 algorithm key
    const hasRS256Key = jwks.keys.some((key: any) => key.alg === 'RS256' && key.kty === 'RSA');
    if (!hasRS256Key) {
      throw new Error('JWKS 中没有找到 RS256 算法的 RSA 密钥');
    }

    return jwks;
  } catch (error) {
    console.error('解析 JWKS 失败:', error);
    throw new Error(`JWKS_KEY 解析错误: ${(error as Error).message}`);
  }
};

const getVerificationKey = async () => {
  try {
    const jwksString = getJwksKeyString();

    if (!jwksString) {
      throw new Error('JWKS_KEY 环境变量未设置');
    }

    const jwks = JSON.parse(jwksString);

    if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new Error('JWKS 格式无效: 缺少或为空的 keys 数组');
    }

    const privateRsaKey = jwks.keys.find((key: any) => key.alg === 'RS256' && key.kty === 'RSA');
    if (!privateRsaKey) {
      throw new Error('JWKS 中没有找到 RS256 算法的 RSA 密钥');
    }

    // Create a “clean” JWK object containing only public key components.
    // The key fields of an RSA public key are kty, n, e. Others like kid, alg, use are also public.
    const publicKeyJwk = {
      alg: privateRsaKey.alg,
      e: privateRsaKey.e,
      kid: privateRsaKey.kid,
      kty: privateRsaKey.kty,
      n: privateRsaKey.n,
      use: privateRsaKey.use,
    };

    // Remove any undefined fields to keep the object clean
    Object.keys(publicKeyJwk).forEach(
      (key) => (publicKeyJwk as any)[key] === undefined && delete (publicKeyJwk as any)[key],
    );

    const { importJWK } = await import('jose');

    // Now, in any environment, `importJWK` will correctly identify this object as a public key.
    return await importJWK(publicKeyJwk, 'RS256');
  } catch (error) {
    log('获取 JWKS 公钥失败: %O', error);
    throw new Error(`JWKS_KEY 公钥获取失败: ${(error as Error).message}`);
  }
};

/**
 * Validate OIDC JWT Access Token
 * @param token - JWT access token
 * @returns Parsed token payload and user information
 */
export const validateOIDCJWT = async (token: string) => {
  try {
    log('开始验证 OIDC JWT token');

    // Get public key
    const publicKey = await getVerificationKey();

    // Verify JWT
    const { jwtVerify } = await import('jose');
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['RS256'],
      // Additional validation options can be added, such as issuer, audience, etc.
    });

    log('JWT 验证成功，payload: %O', payload);

    // Extract user information
    const userId = payload.sub;
    const clientId = payload.client_id;
    const aud = payload.aud;

    if (!userId) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'JWT token 中缺少用户 ID (sub)',
      });
    }

    return {
      clientId,
      payload,
      tokenData: {
        aud: aud,
        client_id: clientId,
        exp: payload.exp,
        iat: payload.iat,
        jti: payload.jti,
        scope: payload.scope,
        sub: userId,
      },
      userId,
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }

    log('JWT 验证失败: %O', error);

    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: `JWT token 验证失败: ${(error as Error).message}`,
    });
  }
};
