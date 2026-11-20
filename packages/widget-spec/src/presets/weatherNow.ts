import type { WidgetPreset } from '@lobechat/types';

// The script runs in the widget sandbox (node, global fetch, no packages).
const SCRIPT = String.raw`// Current weather and the next hours for one city, from Open-Meteo (no key).
const city = process.env.CITY || 'Hangzhou';
const lang = process.env.LANGUAGE || 'en';

const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url.split('?')[0] + ' answered ' + res.status);
  return res.json();
};

const geo = await get(
  'https://geocoding-api.open-meteo.com/v1/search?count=1&name=' +
    encodeURIComponent(city) + '&language=' + encodeURIComponent(lang),
);
const place = geo.results && geo.results[0];
if (!place) {
  console.error('No place found for ' + city);
  process.exit(1);
}

const w = await get(
  'https://api.open-meteo.com/v1/forecast?latitude=' + place.latitude + '&longitude=' + place.longitude +
    '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,is_day' +
    '&hourly=temperature_2m,weather_code,is_day' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=auto&forecast_days=2',
);

// WMO weather code -> a short condition the layout maps to icons and surfaces.
const condOf = (code, isDay) => {
  if (code === 0) return isDay ? 'clear' : 'night';
  if (code <= 2) return isDay ? 'partly' : 'night';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
};

const now = w.current.time.slice(0, 13);
const start = Math.max(0, w.hourly.time.findIndex((t) => t.slice(0, 13) === now));
const hourly = w.hourly.time.slice(start, start + 6).map((t, i) => ({
  cond: condOf(w.hourly.weather_code[start + i], w.hourly.is_day[start + i]),
  t,
  temp: Math.round(w.hourly.temperature_2m[start + i]),
}));

console.log(JSON.stringify({
  data: {
    city: place.name,
    cond: condOf(w.current.weather_code, w.current.is_day),
    hi: Math.round(w.daily.temperature_2m_max[0]),
    hourly,
    humidity: w.current.relative_humidity_2m,
    lo: Math.round(w.daily.temperature_2m_min[0]),
    rainChance: w.daily.precipitation_probability_max[0],
    temp: w.current.temperature_2m,
    wind: w.current.wind_speed_10m,
  },
  type: 'data',
}));
`;

export const weatherNow: WidgetPreset = {
  id: 'weather-now',
  version: '1.0.0',
  category: 'weather',
  contract: 'weather.v1',
  tags: ['weather', 'forecast'],
  title: 'Weather now',
  description:
    'Current temperature, conditions and the next six hours for a city, from Open-Meteo. The card turns sunny, cloudy, rainy or night with the weather.',
  locales: {
    'zh-CN': {
      title: '实时天气',
      description:
        '城市的当前温度、天气和未来 6 小时预报（Open-Meteo）。卡片背景随晴、阴、雨、夜自动变化。',
      params: {
        CITY: {
          label: '城市',
          description: '城市名，中英文均可',
        },
        LANGUAGE: {
          label: '地名语言',
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
      city: 'London',
      cond: 'cloudy',
      hi: 13,
      hourly: [
        {
          cond: 'cloudy',
          t: '2026-11-01T03:00',
          temp: 10,
        },
        {
          cond: 'cloudy',
          t: '2026-11-01T04:00',
          temp: 10,
        },
        {
          cond: 'cloudy',
          t: '2026-11-01T05:00',
          temp: 10,
        },
        {
          cond: 'cloudy',
          t: '2026-11-01T06:00',
          temp: 10,
        },
        {
          cond: 'cloudy',
          t: '2026-11-01T07:00',
          temp: 10,
        },
        {
          cond: 'cloudy',
          t: '2026-11-01T08:00',
          temp: 10,
        },
      ],
      humidity: 92,
      lo: 9,
      rainChance: 31,
      temp: 10.1,
      wind: 4.7,
    },
    type: 'data',
  },
  widget: {
    runtime: 'node',
    outputType: 'data',
    script: SCRIPT,
    manifest: {
      network: {
        allow: ['geocoding-api.open-meteo.com', 'api.open-meteo.com'],
      },
      schedule: {
        pattern: '*/30 * * * *',
      },
      metric: {
        key: 'temp',
        unit: '°C',
        valuePath: 'data.temp',
      },
      params: [
        {
          name: 'CITY',
          type: 'string',
          label: 'City',
          description: 'City name in any language',
          required: true,
          default: 'London',
        },
        {
          name: 'LANGUAGE',
          type: 'select',
          label: 'Place name language',
          default: 'en',
          options: [
            {
              label: 'English',
              value: 'en',
            },
            {
              label: '中文',
              value: 'zh',
            },
            {
              label: '日本語',
              value: 'ja',
            },
            {
              label: 'Deutsch',
              value: 'de',
            },
            {
              label: 'Français',
              value: 'fr',
            },
            {
              label: 'Español',
              value: 'es',
            },
          ],
        },
      ],
    },
    view: {
      surface: {
        bind: 'data.cond',
        map: {
          clear: 'sky',
          partly: 'sky',
          night: 'night',
          cloudy: 'cloudy',
          fog: 'cloudy',
          rain: 'rain',
          snow: 'snow',
          storm: 'storm',
        },
      },
      layout: {
        type: 'stack',
        gap: 4,
        children: [
          {
            type: 'stack',
            direction: 'row',
            justify: 'between',
            align: 'start',
            children: [
              {
                type: 'stack',
                gap: 2,
                children: [
                  {
                    type: 'text',
                    value: {
                      bind: 'data.city',
                    },
                    weight: 'semibold',
                  },
                  {
                    type: 'text',
                    value: {
                      template: '{data.temp|number:0}°',
                    },
                    size: 'display',
                  },
                ],
              },
              {
                type: 'icon',
                name: {
                  bind: 'data.cond',
                  map: {
                    'clear': 'sun',
                    'partly': 'cloud-sun',
                    'night': 'moon',
                    'cloudy': 'cloud',
                    'fog': 'cloud-fog',
                    'rain': 'cloud-rain',
                    'snow': 'cloud-snow',
                    'storm': 'cloud-lightning',
                    '*': 'cloud',
                  },
                },
                size: 40,
              },
            ],
          },
          {
            type: 'text',
            value: {
              template: '↑ {data.hi}°  ↓ {data.lo}°',
            },
            size: 'sm',
            tone: 'secondary',
          },
          {
            type: 'stack',
            direction: 'row',
            gap: 14,
            hideWhen: 'narrow',
            children: [
              {
                type: 'stack',
                direction: 'row',
                gap: 4,
                align: 'center',
                children: [
                  {
                    type: 'icon',
                    name: 'droplets',
                    size: 14,
                  },
                  {
                    type: 'text',
                    value: {
                      template: '{data.humidity}%',
                    },
                    size: 'sm',
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
                    name: 'wind',
                    size: 14,
                  },
                  {
                    type: 'text',
                    value: {
                      template: '{data.wind|number:0} km/h',
                    },
                    size: 'sm',
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
                    name: 'umbrella',
                    size: 14,
                  },
                  {
                    type: 'text',
                    value: {
                      template: '{data.rainChance}%',
                    },
                    size: 'sm',
                  },
                ],
              },
            ],
          },
          {
            type: 'spacer',
          },
          {
            type: 'repeat',
            items: 'data.hourly',
            limit: 6,
            direction: 'row',
            justify: 'between',
            hideWhen: 'short',
            template: {
              type: 'stack',
              gap: 6,
              align: 'center',
              children: [
                {
                  type: 'text',
                  value: {
                    bind: 'item.t',
                    format: 'time',
                  },
                  size: 'xs',
                  tone: 'secondary',
                },
                {
                  type: 'icon',
                  name: {
                    bind: 'item.cond',
                    map: {
                      'clear': 'sun',
                      'partly': 'cloud-sun',
                      'night': 'moon',
                      'cloudy': 'cloud',
                      'fog': 'cloud-fog',
                      'rain': 'cloud-rain',
                      'snow': 'cloud-snow',
                      'storm': 'cloud-lightning',
                      '*': 'cloud',
                    },
                  },
                  size: 18,
                },
                {
                  type: 'text',
                  value: {
                    template: '{item.temp}°',
                  },
                  size: 'sm',
                  weight: 'medium',
                },
              ],
            },
          },
        ],
      },
    },
  },
};
