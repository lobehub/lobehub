import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';

export const importSkill = async (input: { url: string }) => ssrfSafeFetch(input.url);
