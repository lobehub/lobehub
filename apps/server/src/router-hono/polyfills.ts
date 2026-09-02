import 'reflect-metadata';

import { installDomMatrixPolyfill } from '@lobechat/file-loaders';

// In the bundled runtime these polyfills must land before any other module evaluates:
// tsyringe (via @peculiar/x509) checks Reflect.getMetadata in its module body, and pdfjs-dist
// runs `new DOMMatrix()` in its module body while officeparser requires it eagerly.
installDomMatrixPolyfill();
