/* eslint-disable no-restricted-imports */
// Entry list for the design-prototype runtime bundle.
// Everything a prototype can import lives here, re-exported as namespaces on a
// single IIFE global. Bundled from THIS repo's node_modules, so versions match
// production exactly. Missing a component? Add it below and rebuild (~2s):
//   bash .agents/skills/design-prototype/scripts/build-runtime.sh
import { Amp, ClaudeCode, Codex, HermesAgent, OpenClaw, OpenCode } from '@lobehub/icons';
import {
  ActionIcon,
  Alert,
  Avatar,
  Block,
  Button,
  Center,
  Collapse,
  DraggablePanel,
  Drawer,
  DropdownMenu,
  Empty,
  Flexbox,
  Highlighter,
  Hotkey,
  Icon,
  Image,
  Input,
  InputNumber,
  Markdown,
  Modal,
  NeuralNetworkLoading,
  Popover,
  ScrollShadow,
  SearchBar,
  Segmented,
  Select,
  Skeleton,
  SortableList,
  Tabs,
  Tag,
  Text,
  TextArea,
  ThemeProvider,
  Tooltip,
} from '@lobehub/ui';
import * as baseUI from '@lobehub/ui/base-ui';
import {
  App,
  Badge,
  Checkbox,
  Divider,
  Dropdown,
  Progress,
  Radio,
  Slider,
  Space,
  Steps,
  Table,
} from 'antd';
import * as antdStyle from 'antd-style';
import * as lucide from 'lucide-react';
import * as react from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as reactDom from 'react-dom';
import * as reactDomClient from 'react-dom/client';

export default {
  '@lobehub/ui': {
    ActionIcon,
    Alert,
    Avatar,
    Block,
    Button,
    Center,
    Collapse,
    DraggablePanel,
    Drawer,
    DropdownMenu,
    Empty,
    Flexbox,
    Highlighter,
    Hotkey,
    Icon,
    Image,
    Input,
    InputNumber,
    Markdown,
    Modal,
    NeuralNetworkLoading,
    Popover,
    ScrollShadow,
    SearchBar,
    Segmented,
    Select,
    Skeleton,
    SortableList,
    Tabs,
    Tag,
    Text,
    TextArea,
    ThemeProvider,
    Tooltip,
  },
  '@lobehub/icons': { Amp, ClaudeCode, Codex, HermesAgent, OpenClaw, OpenCode },
  '@lobehub/ui/base-ui': baseUI,
  'antd': { App, Badge, Checkbox, Divider, Dropdown, Progress, Radio, Slider, Space, Steps, Table },
  'antd-style': antdStyle,
  'lucide-react': lucide,
  'react': react,
  'react-dom': reactDom,
  'react-dom/client': reactDomClient,
  'react/jsx-runtime': jsxRuntime,
};
