import type { WidgetPreset } from '@lobechat/types';

// The script runs in the widget sandbox (node, global fetch, no packages).
const SCRIPT = String.raw`// Days until (or since) a date, counted in the chosen time zone.
const title = process.env.TITLE || 'Countdown';
const target = process.env.DATE;
const timeZone = process.env.TIMEZONE || 'UTC';
if (!/^\d{4}-\d{2}-\d{2}$/.test(target || '')) {
  console.error('DATE must be YYYY-MM-DD');
  process.exit(1);
}

const today = new Intl.DateTimeFormat('en-CA', { day: '2-digit', month: '2-digit', timeZone, year: 'numeric' })
  .format(new Date());
const days = Math.round((Date.parse(target) - Date.parse(today)) / 86400000);

console.log(JSON.stringify({
  data: { date: target, days: Math.abs(days), passed: days < 0, title, today },
  type: 'data',
}));
`;

export const countdown: WidgetPreset = {
  id: 'countdown',
  version: '1.0.0',
  category: 'time',
  contract: 'countdown.v1',
  tags: ['countdown', 'date', 'holiday'],
  title: 'Countdown',
  description:
    'Days left until a date you care about — a holiday, a launch, a birthday — and days since once it has passed.',
  locales: {
    'zh-CN': {
      title: '倒数日',
      description: '距离一个重要日子还有几天（假期、发布、生日），过了之后显示已过去几天。',
      params: {
        TITLE: {
          label: '名称',
        },
        DATE: {
          label: '日期',
        },
        TIMEZONE: {
          label: '时区',
          description: 'IANA 时区，例如 Asia/Shanghai',
        },
      },
    },
  },
  size: {
    w: 3,
    h: 3,
  },
  sample: {
    data: {
      date: '2027-01-01',
      days: 61,
      passed: false,
      title: 'Countdown',
      today: '2026-11-01',
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
          name: 'TITLE',
          type: 'string',
          label: 'Name',
          default: 'New Year',
        },
        {
          name: 'DATE',
          type: 'date',
          label: 'Date',
          required: true,
          default: '2027-01-01',
        },
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
      surface: 'sunset',
      layout: {
        type: 'stack',
        gap: 4,
        children: [
          {
            type: 'text',
            value: {
              bind: 'data.title',
            },
            weight: 'semibold',
          },
          {
            type: 'spacer',
          },
          {
            type: 'stack',
            direction: 'row',
            align: 'baseline',
            gap: 6,
            children: [
              {
                type: 'text',
                value: '+',
                size: '2xl',
                visible: {
                  bind: 'data.passed',
                  eq: true,
                },
              },
              {
                type: 'text',
                value: {
                  bind: 'data.days',
                  format: 'number',
                },
                size: 'display',
              },
            ],
          },
          {
            type: 'stack',
            direction: 'row',
            gap: 4,
            align: 'center',
            children: [
              {
                type: 'icon',
                name: 'calendar',
                size: 14,
              },
              {
                type: 'text',
                value: {
                  bind: 'data.date',
                  format: 'date',
                  pattern: 'YYYY-MM-DD',
                },
                size: 'sm',
                tone: 'secondary',
              },
            ],
          },
        ],
      },
    },
  },
};
