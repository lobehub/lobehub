import { OPS_ASSETS_BASE_URL } from '@lobechat/const';

export interface ChiefAgentAvatarPreset {
  avatar: string;
  hero: string;
  id: string;
  tint: string;
}

const asset = (hash: string) => `${OPS_ASSETS_BASE_URL}/${hash}.webp`;

const preset = (
  id: string,
  heroHash: string,
  avatarHash: string,
  tint: string,
): ChiefAgentAvatarPreset => ({
  avatar: asset(avatarHash),
  hero: asset(heroHash),
  id,
  tint,
});

export const CHIEF_AGENT_AVATAR_PRESETS: ChiefAgentAvatarPreset[] = [
  preset(
    'lobe',
    'aecf77a7df115e25f612dcdbfa250a87f1aaff4604c4cab932bcacd0aa04da2b',
    '887f1fa54f3896e91d8a0f5633f241bdc1bbddfe0877b806fe332be6194beed9',
    '#c98d81',
  ),
  preset(
    'blueprint',
    '1375f50a1877121d132300d857aa409dfb8e502c56fa85025c157d70ac047432',
    '9f544d279dba487afe9134872bedc713add740fe8ecf7537b3ffe3dcadf828bd',
    '#949dac',
  ),
  preset(
    'breeze',
    '81e103976bef00a09a3171b07485f16c5f68251030c076875d4d7fc5cc1200a4',
    '060291e30cf08dd0cc19b1cd6b756a5a02f006c08a22cfca41f67aa18ac0c85b',
    '#7e9d40',
  ),
  preset(
    'buttercup',
    '5596341587517e573d0816c5c1590798adb9569e5c37a3e9dd46071365bfc2a7',
    '6c69dcfa89c9500fcc8929335e471de2badbf14cb365745db100dc410d46e78b',
    '#eea856',
  ),
  preset(
    'byte',
    'b6bb53d017ddd9161429a8b8022c4122091f644ece78af84fb6bcadcb995cbb6',
    '99d6ed604c0e068fd6cfe0d1df85b49caa7305ec6760a3059a8728d7be028e0d',
    '#5a97db',
  ),
  preset(
    'coco',
    'a164b67adff205466b2b0987cb1dcb34830bf0cab5d5dd17bbbc1ffb7d139212',
    '29a341b373683443f4a933026e1610357604e3e38e60f5a4c0acf44a6d851ab6',
    '#f090a8',
  ),
  preset(
    'dispatch',
    '18675c706284614bfa569386b7d48cc04168c788e6fe14afb1e202a55e898874',
    'fde19dbb08eeaae54e217a62f1d75dc0ed08b1e94f5782f071dc62c4a5bce0af',
    '#5982c0',
  ),
  preset(
    'flex',
    '8e454fc33f0478d8fbb209d5db1e0b2416db4acb3321bb0a0abd184015a2f5cc',
    'ed5fa7edf75d4b5861fa312e51caa5797ddd0bd781eb81fb217f742758f78e77',
    '#e17530',
  ),
  preset(
    'hexley',
    '2b76a6229698229c9cdcc80668fcf218b2bd4c632c4511840f6ff99352f5754b',
    '6740bc9a4836a1a27394c615fc349875139627d663a66addf2b46bbbbe063f79',
    '#864fa4',
  ),
  preset(
    'kernel',
    '5ec913f157704c4b8f8cd2ddebfcbf1da780e8cc25edcc2f8c4639d672f659b2',
    '16dd03b20d96dcb84c44b3f000e25b6fe784dd7af4a18245f28251a3cb1bb60d',
    '#42424c',
  ),
  preset(
    'latte',
    'a63be4071d9145084c6ee8e494d58d74ec561e45140dbecad5669ccda002f228',
    '76503f233e866ae6e09530d1e6037ad41b01efb7901bc43ad6081da6a55250c6',
    '#c17739',
  ),
  preset(
    'maestro',
    '0f62471c801fb327f8f4edec153136fcde1dfbb49bf81f51e043aa7692e647d8',
    '91d99e04f0808653d9a249b60f8aac3ffba127816f70eef8dcf95f3866c170fb',
    '#b36bbc',
  ),
  preset(
    'moss',
    '557aca98e44af6ec65f3ed9e573f5d97c3342f3fe171441472845e8da64123fb',
    '6ec33a8a3708cd2a4f01d0f40eeb1c50dedda73000b4a79eaf6a1a3aaba7a076',
    '#d99d39',
  ),
  preset(
    'riot',
    '58539f0e1efe9155324c49a23cab20c5e50c5c69e5f4099fd58492967c42c712',
    'd2c5ccc860e92b42a8bbeef8262b140afaade3d9d4227f39af7a6af060c8c277',
    '#c43736',
  ),
  preset(
    'shutter',
    '811ad76b771ace2f9a050aeb47bf38ae59ab5aeb2dd1599ae1a7437c3863bd7e',
    '1f905a9d3f1fa5af15ae7443f76c9fca93eed7e8170d87dd68ab35e3aa743663',
    '#3f3c3e',
  ),
  preset(
    'sienna',
    '9622c5fbc4dc7d87457299d5fa73d7c456f95929dcbb10d8639e3cd476f74969',
    '3e72dc1976f3c5089e9e196dc0769baa1ac52eb1e9bc50a100a8d54ff1f1a36f',
    '#e9ad39',
  ),
];

export const findChiefAgentPresetByAvatar = (avatar: string): ChiefAgentAvatarPreset | undefined =>
  CHIEF_AGENT_AVATAR_PRESETS.find((item) => item.avatar === avatar);
