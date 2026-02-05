 
/**
 * 本动态加载模块使用 SystemJS 实现，在 Lobe Chat 中缓存了 React、ReactDOM、antd、antd-style 四个模块。
 */
import 'systemjs';

import * as antd from 'antd';
import * as AntdStyle from 'antd-style';
import * as React from 'react';
import * as ReactDOM from 'react-dom';

System.addImportMap({
  imports: {
    'React': 'app:React',
    'ReactDOM': 'app:ReactDOM',
    'antd': 'app:antd',
    'antd-style': 'app:antd-style',
  },
});

System.set('app:React', { default: React, ...React });
System.set('app:ReactDOM', { __useDefault: true, ...ReactDOM });
System.set('app:antd', antd);
System.set('app:antd-style', AntdStyle);

export const system = System;
