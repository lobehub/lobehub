import { USD_TO_CNY } from '@lobechat/const';
import dayjs from 'dayjs';
import { isNumber } from 'es-toolkit/compat';
import type { ModelPriceCurrency } from 'model-bank';
import numeral from 'numeral';

export const formatSize = (bytes: number, fractionDigits: number = 1): string => {
  if (!bytes && bytes !== 0) return '--';

  const kbSize = bytes / 1024;
  if (kbSize < 1024) {
    return `${kbSize.toFixed(fractionDigits)} KB`;
  } else if (kbSize < 1_048_576) {
    const mbSize = kbSize / 1024;
    return `${mbSize.toFixed(fractionDigits)} MB`;
  } else {
    const gbSize = kbSize / 1_048_576;
    return `${gbSize.toFixed(fractionDigits)} GB`;
  }
};

/**
 * format speed from Byte number to string like KB/s, MB/s or GB/s
 */
export const formatSpeed = (byte: number, fractionDigits = 2) => {
  if (!byte && byte !== 0) return '--';

  let word = '';

  // Byte
  if (byte <= 1000) {
    word = byte.toFixed(fractionDigits) + ' Byte/s';
  }
  // KB
  else if (byte / 1024 <= 1000) {
    word = (byte / 1024).toFixed(fractionDigits) + ' KB/s';
  }
  // MB
  else if (byte / 1024 / 1024 <= 1000) {
    word = (byte / 1024 / 1024).toFixed(fractionDigits) + ' MB/s';
  }
  // GB
  else {
    word = (byte / 1024 / 1024 / 1024).toFixed(fractionDigits) + ' GB/s';
  }

  return word;
};

export const formatTime = (timeInSeconds: number): string => {
  if (!timeInSeconds && timeInSeconds !== 0) return '--';
  if (!isNumber(timeInSeconds)) return timeInSeconds;

  if (timeInSeconds < 60) {
    return `${timeInSeconds.toFixed(1)} s`;
  } else if (timeInSeconds < 3600) {
    return `${(timeInSeconds / 60).toFixed(1)} min`;
  } else {
    return `${(timeInSeconds / 3600).toFixed(2)} h`;
  }
};

export const formatShortenNumber = (num: any) => {
  if (!num && num !== 0) return '--';
  if (!isNumber(num)) return num;

  // Use Intl.NumberFormat to add thousand separators
  const formattedWithComma = new Intl.NumberFormat('en-US').format(num);

  // Format as K or M
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + 'M';
  } else if (num >= 10_000) {
    return (num / 1000).toFixed(1) + 'K';
  } else if (num === 0) {
    return 0;
  } else {
    return formattedWithComma;
  }
};

export const formatNumber = (num: any, fractionDigits?: number) => {
  if (!num && num !== 0) return '--';

  if (!fractionDigits) return new Intl.NumberFormat('en-US').format(num);
  const [a, b] = num.toFixed(fractionDigits).split('.');
  return `${numeral(a).format('0,0')}.${b}`;
};

export const formatIntergerNumber = (num?: any) => {
  if (!num && num !== 0) return '--';

  return numeral(num).format('0,0');
};

export const formatTokenNumber = (num: number): string => {
  if (!num && num !== 0) return '--';

  if (num > 0 && num < 1024) return '1K';

  let kiloToken = Math.floor(num / 1024);
  if ((num >= 1024 && num < 1024 * 41) || num >= 128_000) {
    kiloToken = Math.floor(num / 1000);
  }
  if (num === 131_072) return '128K';
  return kiloToken < 1000 ? `${kiloToken}K` : `${Math.floor(kiloToken / 1000)}M`;
};

export const formatPrice = (price: number, fractionDigits: number = 2) => {
  if (!price && price !== 0) return '--';

  if (fractionDigits === 0) return numeral(price).format('0,0');

  const [a, b] = price.toFixed(fractionDigits).split('.');
  return `${numeral(a).format('0,0')}.${b}`;
};

export const formatPriceByCurrency = (price?: number, currency?: ModelPriceCurrency) => {
  if (!price && price !== 0) return '-';

  if (currency === 'CNY') {
    return formatPrice(price / USD_TO_CNY);
  }
  return formatPrice(price);
};

export const formatDate = (date?: Date) => {
  if (!date) return '--';

  return dayjs(date).format('YYYY-MM-DD');
};
