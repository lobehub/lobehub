'use client';

import { defineFixtures, single } from './_helpers';

const pageState = {
  title: 'LobeHub Documentation',
  url: 'https://lobehub.com/docs',
};

export default defineFixtures({
  identifier: 'lobe-browser',
  fixtures: {
    click: single({
      args: { ref: 'e12' },
      content: 'Clicked e12. Now at https://lobehub.com/docs — "LobeHub Documentation".',
      pluginState: pageState,
    }),
    fill: single({
      args: { ref: 'e24', text: 'Browser tool rendering' },
      content: 'Filled e24 with "Browser tool rendering".',
    }),
    navigate: single({
      args: { url: 'https://lobehub.com/docs' },
      content: 'Opened https://lobehub.com/docs — "LobeHub Documentation"',
      pluginState: pageState,
    }),
    press: single({
      args: { key: 'Enter' },
      content: 'Pressed Enter.',
    }),
    readPage: single({
      args: {},
      content:
        'Page: LobeHub Documentation (https://lobehub.com/docs)\nBuild and collaborate with specialized AI agents in one workspace.',
      pluginState: {
        ...pageState,
        content: 'Build and collaborate with specialized AI agents in one workspace.',
      },
    }),
    screenshot: single({
      args: {},
      content: 'Screenshot captured (960×540) and shown to the user.',
      pluginState: {
        dataUrl:
          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"%3E%3Crect width="960" height="540" fill="%23f4f4f5"/%3E%3Crect x="72" y="64" width="816" height="412" rx="24" fill="white" stroke="%23d4d4d8"/%3E%3Ctext x="120" y="150" font-family="system-ui" font-size="42" font-weight="700" fill="%2318181b"%3ELobeHub Browser%3C/text%3E%3Ctext x="120" y="210" font-family="system-ui" font-size="24" fill="%2352525b"%3EScreenshot render fixture%3C/text%3E%3C/svg%3E',
        height: 540,
        width: 960,
      },
    }),
    scroll: single({
      args: { dx: 0, dy: 640 },
      content: 'Scrolled by 640px.',
    }),
    snapshot: single({
      args: {},
      content:
        'Page: LobeHub Documentation (https://lobehub.com/docs)\nheading "Documentation" [ref=e1]\nlink "Getting started" [ref=e12]\ntextbox "Search docs" [ref=e24]',
      pluginState: {
        ...pageState,
        snapshot:
          'heading "Documentation" [ref=e1]\nlink "Getting started" [ref=e12]\ntextbox "Search docs" [ref=e24]',
      },
    }),
  },
});
