#!/usr/bin/env node
/**
 * OIDC JWKS key generation script
 * Generates an RSA key pair for use by the OIDC Provider and converts it to JWKS format
 *
 * Usage:
 * node scripts/generate-oidc-jwk.mjs
 *
 * Set the output single-line JSON string as the environment variable OIDC_JWKS_KEY
 */
import crypto from 'node:crypto';

import { exportJWK, generateKeyPair } from 'jose';

// Generate key ID
function generateKeyId() {
  return crypto.randomBytes(8).toString('hex');
}

async function generateJwks() {
  try {
    console.error('正在生成 RSA 密钥对...');

    // Generate RS256 key pair
    const { privateKey } = await generateKeyPair('RS256', {
      extractable: true,
    });

    // Export as JWK format
    const jwk = await exportJWK(privateKey);

    // Add required fields
    jwk.use = 'sig'; // Purpose: signature
    jwk.kid = generateKeyId(); // Key ID
    jwk.alg = 'RS256'; // Algorithm

    // Create JWKS (JSON Web Key Set)
    const jwks = { keys: [jwk] };

    // Convert to JSON string
    const jwksString = JSON.stringify(jwks);

    // Output JWKS JSON as a single-line string
    console.log(jwksString);

    // Console output
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

// Execute main function
generateJwks();
