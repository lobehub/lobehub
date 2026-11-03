import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env')) {
  loadEnvFile();
}
