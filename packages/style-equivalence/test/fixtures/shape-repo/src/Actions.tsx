import { Button, Image } from 'fixture-ui';

import actions from './Actions.module.css';
import footer from './Footer.module.css';
import thumb from './Thumb.module.css';

export const Actions = () => (
  <div className={actions.actions}>
    <Button>Go</Button>
  </div>
);

export const Footer = () => (
  <div className={footer.footer}>
    <Button>Send</Button>
  </div>
);

export const Thumb = () => (
  <div className={thumb.thumb}>
    <Image alt="" />
  </div>
);
