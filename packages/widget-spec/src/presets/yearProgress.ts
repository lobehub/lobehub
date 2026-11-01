import type { WidgetPreset } from '@lobechat/types';

// The script runs in the widget sandbox (node, global fetch, no packages).
const SCRIPT = String.raw`// How far through the year, month and week today is, in the chosen time zone.
const timeZone = process.env.TIMEZONE || 'UTC';
const today = new Intl.DateTimeFormat('en-CA', { day: '2-digit', month: '2-digit', timeZone, year: 'numeric' })
  .format(new Date());
const [year, month, day] = today.split('-').map(Number);

const utc = (y, m, d) => Date.UTC(y, m - 1, d);
const dayOfYear = (utc(year, month, day) - utc(year, 1, 1)) / 86400000 + 1;
const daysInYear = (utc(year + 1, 1, 1) - utc(year, 1, 1)) / 86400000;
const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
const weekday = (new Date(utc(year, month, day)).getUTCDay() + 6) % 7; // Monday = 0

console.log(JSON.stringify({
  data: {
    day: dayOfYear,
    daysInYear,
    month: day / daysInMonth,
    week: (weekday + 1) / 7,
    weeksPassed: Math.floor((dayOfYear - 1) / 7),
    // a label, not a quantity: printed without digit grouping
    year: String(year),
    yearRatio: dayOfYear / daysInYear,
  },
  type: 'data',
}));
`;

export const yearProgress: WidgetPreset = {
  id: 'year-progress',
  version: '1.0.0',
  category: 'time',
  contract: 'year-progress.v1',
  tags: ['time', 'progress'],
  title: 'Year progress',
  description:
    'How much of the year has gone, as a percentage and one dot per week, with the day count.',
  locales: {
    'zh-CN': {
      title: '年度进度',
      description: '今年已经过去多少：百分比、每周一个点，以及第几天。',
      params: {
        TIMEZONE: {
          label: '时区',
          description: 'IANA 时区，例如 Asia/Shanghai',
        },
      },
    },
  },
  size: {
    w: 4,
    h: 4,
  },
  sample: {
    data: {
      day: 305,
      daysInYear: 365,
      month: 0.03333333333333333,
      week: 1,
      weeksPassed: 43,
      year: '2026',
      yearRatio: 0.8356164383561644,
    },
    type: 'data',
  },
  widget: {
    runtime: 'node',
    outputType: 'data',
    script: SCRIPT,
    manifest: {
      schedule: {
        pattern: '0 * * * *',
      },
      params: [
        {
          name: 'TIMEZONE',
          type: 'string',
          label: 'Time zone',
          description: 'IANA time zone, e.g. Europe/Berlin',
          default: 'UTC',
        },
      ],
    },
    view: {
      surface: 'forest',
      layout: {
        type: 'stack',
        gap: 8,
        children: [
          {
            type: 'stack',
            direction: 'row',
            justify: 'between',
            align: 'baseline',
            children: [
              {
                type: 'text',
                value: {
                  bind: 'data.year',
                },
                weight: 'semibold',
              },
              {
                type: 'text',
                value: {
                  template: '{data.day} / {data.daysInYear}',
                },
                size: 'sm',
                tone: 'secondary',
              },
            ],
          },
          {
            type: 'text',
            value: {
              bind: 'data.yearRatio',
              format: 'percent',
            },
            size: 'display',
          },
          {
            type: 'spacer',
          },
          {
            type: 'dots',
            value: {
              bind: 'data.weeksPassed',
            },
            total: 52,
            columns: 26,
            hideWhen: 'short',
          },
        ],
      },
    },
  },
};
