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
 * 从环境变量中获取 JWKS
 * 该 JWKS 是一个包含 RS256 私钥的 JSON 对象
 */
export const getJWKS = (): object => {
  try {
    const jwksString = getJwksKeyString();

    if (!jwksString) {
      throw new Error(
        'JWKS_KEY 环境变量是必需的。请使用 scripts/generate-oidc-jwk.mjs 生成 JWKS。',
      );
    }

    // 尝试解析 JWKS JSON 字符串
    const jwks = JSON.parse(jwksString);

    // 检查 JWKS 格式是否正确
    if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new Error('JWKS 格式无效: 缺少或为空的 keys 数组');
    }

    // 检查是否有 RS256 算法的密钥
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

    // 创建一个只包含公钥组件的“纯净”JWK对象。
    // RSA公钥的关键字段是 kty, n, e。其他如 kid, alg, use 也是公共的。
    const publicKeyJwk = {
      alg: privateRsaKey.alg,
      e: privateRsaKey.e,
      kid: privateRsaKey.kid,
      kty: privateRsaKey.kty,
      n: privateRsaKey.n,
      use: privateRsaKey.use,
    };

    // 移除任何可能存在的 undefined 字段，保持对象干净
    Object.keys(publicKeyJwk).forEach(
      (key) => (publicKeyJwk as any)[key] === undefined && delete (publicKeyJwk as any)[key],
    );

    const { importJWK } = await import('jose');

    // 现在，无论在哪个环境下，`importJWK` 都会将这个对象正确地识别为一个公钥。
    return await importJWK(publicKeyJwk, 'RS256');
  } catch (error) {
    log('获取 JWKS 公钥失败: %O', error);
    throw new Error(`JWKS_KEY 公钥获取失败: ${(error as Error).message}`);
  }
};

/**
 * 验证 OIDC JWT Access Token
 * @param token - JWT access token
 * @returns 解析后的 token payload 和用户信息
 */
export const validateOIDCJWT = async (token: string) => {
  try {
    log('开始验证 OIDC JWT token');

    // 获取公钥
    const publicKey = await getVerificationKey();

    // 验证 JWT
    const { jwtVerify } = await import('jose');
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['RS256'],
      // 可以添加其他验证选项，如 issuer、audience 等
    });

    log('JWT 验证成功，payload: %O', payload);

    // 提取用户信息
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
