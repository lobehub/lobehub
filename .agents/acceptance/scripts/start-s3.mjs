#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import S3rver from 's3rver';

const port = Number(process.env.S3_DEV_PORT || 29_000);
const address = process.env.S3_DEV_ADDRESS || '127.0.0.1';
const bucket = process.env.S3_BUCKET || 'agent-testing-bucket';
const directory = path.resolve(process.env.S3_DATA_DIR || '.records/data/agent-testing-s3');

const origins = new Set();
for (const candidate of [process.env.APP_URL, process.env.S3_ALLOWED_ORIGIN]) {
  if (!candidate) continue;
  try {
    origins.add(new URL(candidate).origin);
  } catch {
    console.error(`Invalid S3 CORS origin: ${candidate}`);
    process.exit(1);
  }
}
for (const candidatePort of [process.env.PORT, process.env.SPA_PORT, process.env.VITE_DEV_PORT]) {
  if (!candidatePort) continue;
  origins.add(`http://localhost:${candidatePort}`);
  origins.add(`http://127.0.0.1:${candidatePort}`);
}

const corsRules = [...origins]
  .map(
    (origin) => `
  <CORSRule>
    <AllowedOrigin>${origin}</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedMethod>DELETE</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
  </CORSRule>`,
  )
  .join('');
const corsConfig = `<CORSConfiguration>${corsRules}\n</CORSConfiguration>`;

fs.mkdirSync(directory, { recursive: true });

const server = new S3rver({
  address,
  configureBuckets: [{ configs: [corsConfig], name: bucket }],
  directory,
  port,
  silent: false,
});

const close = async (signal) => {
  console.log(`\nReceived ${signal}; stopping local S3 server...`);
  await server.close();
  process.exit(0);
};

process.once('SIGINT', () => void close('SIGINT'));
process.once('SIGTERM', () => void close('SIGTERM'));

try {
  await server.run();
  console.log('Agent-testing S3 server is ready:');
  console.log(`  endpoint: http://${address}:${port}`);
  console.log(`  bucket:   ${bucket}`);
  console.log(`  data:     ${directory}`);
} catch (error) {
  console.error('Failed to start agent-testing S3 server:', error);
  process.exit(1);
}
