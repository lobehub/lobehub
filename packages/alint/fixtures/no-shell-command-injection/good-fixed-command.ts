import { exec } from 'node:child_process';

export const version = () => exec('git --version');
