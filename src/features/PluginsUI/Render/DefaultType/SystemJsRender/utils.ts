 
/**
 * This dynamic loading module is implemented using SystemJS, caching four modules in Lobe Chat: React, ReactDOM, antd, and antd-style.
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
