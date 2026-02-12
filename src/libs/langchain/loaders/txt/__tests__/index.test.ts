// @vitest-environment node
import * as fs from 'node:fs';
import { join } from 'node:path';

import { TextLoader } from '../index';
import longResult from './long.json';

describe('TextLoader', () => {
  it('split simple content', async () => {
    const content = `好的,我们以基于 Puppeteer 的截图服务为例,给出一个具体的示例:

| 服务器配置 | 并发量 |
| --- | --- |
| 1c1g | 50-100 |
| 2c4g | 200-500 |
| 4c8g | 500-1000 |
| 8c16g | 1000-2000 |

这里的并发量是根据以下假设条件估算的:

1. 应用程序使用 Puppeteer 进行网页截图,每个请求需要 500ms-1s 的处理时间。
2. CPU 密集型任务,CPU 是主要的性能瓶颈。
3. 每个请求需要 50-100MB 的内存。
4. 没有其他依赖服务,如数据库等。
5. 网络带宽足够,不是瓶颈。

在这种情况下:

- 1c1g 的服务器,由于 CPU 资源较少,并发量较低,大约在 50-100 左右。
- 2c4g 的服务器,CPU 资源增加,并发量可以提高到 200-500 左右。
- 4c8g 的服务器,CPU 资源进一步增加,并发量可以提高到 500-1000 左右。
- 8c16g 的服务器,CPU 资源进一步增加,并发量可以提高到 1000-2000 左右。

需要注意的是,这只是一个大致的估计,实际情况可能会有差异。在正式部署时,建议进行负载测试,根据实际情况进行调整和优化。`;

    const result = await TextLoader(content);

    expect(result).toEqual([
      {
        pageContent:
          '好的,我们以基于 Puppeteer 的截图服务为例,给出一个具体的示例:\n\n| 服务器配置 | 并发量 |\n| --- | --- |\n| 1c1g | 50-100 |\n| 2c4g | 200-500 |\n| 4c8g | 500-1000 |\n| 8c16g | 1000-2000 |\n\n这里的并发量是根据以下假设条件估算的:\n\n1. 应用程序使用 Puppeteer 进行网页截图,每个请求需要 500ms-1s 的处理时间。\n2. CPU 密集型任务,CPU 是主要的性能瓶颈。\n3. 每个请求需要 50-100MB 的内存。\n4. 没有其他依赖服务,如数据库等。\n5. 网络带宽足够,不是瓶颈。\n\n在这种情况下:\n\n- 1c1g 的服务器,由于 CPU 资源较少,并发量较低,大约在 50-100 左右。\n- 2c4g 的服务器,CPU 资源增加,并发量可以提高到 200-500 左右。\n- 4c8g 的服务器,CPU 资源进一步增加,并发量可以提高到 500-1000 左右。\n- 8c16g 的服务器,CPU 资源进一步增加,并发量可以提高到 1000-2000 左右。\n\n需要注意的是,这只是一个大致的估计,实际情况可能会有差异。在正式部署时,建议进行负载测试,根据实际情况进行调整和优化。',
        metadata: { loc: { lines: { from: 1, to: 25 } } },
      },
    ]);
  });

  it('split long', async () => {
    const content = fs.readFileSync(join(__dirname, `./pg24022.txt`), 'utf8');

    const result = await TextLoader(content);

    expect(result).toEqual(longResult);
  });
});
