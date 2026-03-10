#!/usr/bin/env node
/**
 * OIDC JWKS 密钥生成脚本
 * 用于生成 OIDC Provider 使用的 RSA 密钥对并转换为 JWKS 格式
 *
 * 使用方法:
 * node scripts/generate-oidc-jwk.mjs
 *
 * 将输出的单行 JSON 字符串设置为环境变量 OIDC_JWKS_KEY
 */
import { exportJWK, generateKeyPair } from 'jose';
import crypto from 'node:crypto';

// 生成密钥 ID
function generateKeyId() {
  return crypto.randomBytes(8).toString('hex');
}

async function generateJwks() {
  try {
    console.error('正在生成 RSA 密钥对...');

    // 生成 RS256 密钥对
    const { privateKey } = await generateKeyPair('RS256', {
      extractable: true,
    });

    // 导出为 JWK 格式
    const jwk = await exportJWK(privateKey);

    // 添加必要的字段
    jwk.use = 'sig'; // 用途: 签名
    jwk.kid = generateKeyId(); // 密钥 ID
    jwk.alg = 'RS256'; // 算法

    // 创建 JWKS (JSON Web Key Set)
    const jwks = { keys: [jwk] };

    // 转换为JSON字符串
    const jwksString = JSON.stringify(jwks);

    // 输出 JWKS JSON 单行字符串
    console.log(jwksString);

    // 控制台提示
    console.error('\n✅ JWKS 已生成');
    console.error('请将上面输出的 JSON 字符串直接设置为环境变量 OIDC_JWKS_KEY');
    console.error('例如在 .env 文件中添加:');
    console.error('\n> 环境变量配置行 (可直接复制):');
    console.error(`OIDC_JWKS_KEY='${jwksString}'`);
    console.error('\n⚠️ 重要: 请妥善保管此密钥，它用于签署所有 OIDC 令牌');

    return jwks;
  } catch (error) {
    console.error('❌ 生成 JWKS 时出错:', error);
    process.exit(1);
  }
}

// 执行主函数
// eslint-disable-next-line unicorn/prefer-top-level-await
generateJwks();
