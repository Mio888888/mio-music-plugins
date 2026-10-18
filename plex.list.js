/**
 * @name Plex（列表）
 * @version 1.0.0
 * @author Mio Music
 * @description Plex Media Server 的音乐库：搜索、专辑与歌单、最近添加/常听歌曲、歌手，并由本插件提供播放与下载地址。
 *
 * Music-list plugin for the Mio Music GPUI host (source ID `plex`). It talks to one Plex Media
 * Server directly with an X-Plex-Token, in one music library (the first, unless one is named in
 * the configuration form).
 */
const SOURCE = 'plex';
const PAGE = 30;
const LIBRARY_TTL_MS = 10 * 60 * 1000;
const ALBUM_KINDS = [
  ['newest', '最新添加', 'addedAt:desc'],
  ['recent', '最近播放', 'lastViewedAt:desc'],
  ['frequent', '常听专辑', 'viewCount:desc'],
  ['rated', '最高评分', 'userRating:desc'],
  ['alphabeticalByName', '按名称', 'titleSort'],
];
const CHARTS = [
  ['newest', '最近添加', 'addedAt:desc'],
  ['recent', '最近播放', 'lastViewedAt:desc'],
  ['frequent', '常听歌曲', 'viewCount:desc'],
  ['rated', '高分歌曲', 'userRating:desc'],
];

const str = (o, k) => (o !== null && typeof o === 'object' && typeof o[k] === 'string' ? o[k] : '');
const num = (v) => (Number.isFinite(v) ? v : 0);
const arr = (v) => (Array.isArray(v) ? v : []);
const playTime = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const pages = (total, limit) => Math.ceil(total / limit);
const enc = (s) => encodeURIComponent(String(s));

// ─── configuration ─────────────────────────────────────────
function settings() {
  const c = cerumusic.config || {};
  const baseUrl = String(c.baseUrl || '').trim();
  const token = String(c.token || '').trim();
  if (!baseUrl || !token) throw new Error('请先在插件“配置”中填写服务器地址和 Plex 令牌（X-Plex-Token）');
  const m = /^(https?):\/\/([^\/?#@]+)(\/[^?#]*)?$/i.exec(baseUrl);
  if (!m) throw new Error('服务器地址无效');
  const loopback = /^(localhost|127(\.\d{1,3}){3}|\[::1\])(:\d+)?$/i.test(m[2]);
  if (m[1].toLowerCase() === 'http' && !loopback && c.allowHttp !== true) {
    throw new Error('HTTP 服务器需要在配置中勾选“允许 HTTP（不加密）”');
  }
  return {
    base: `${m[1].toLowerCase()}://${m[2]}${(m[3] || '').replace(/\/+$/, '')}`,
    token,
    library: String(c.library || '').trim(),
  };
}

function clientId() {
  let id = cerumusic.storage.get('clientId');
  if (typeof id !== 'string' || !id) {
    id = 'mio-';
    for (let i = 0; i < 24; i += 1) id += Math.floor(Math.random() * 16).toString(16);
    cerumusic.storage.set('clientId', id);
  }
  return id;
}

const headers = (s) => ({
  Accept: 'application/json',
  'X-Plex-Token': s.token,
  'X-Plex-Client-Identifier': clientId(),
  'X-Plex-Product': 'Mio Music',
  'X-Plex-Version': '1.0',
  'X-Plex-Device-Name': 'Mio Music',
});

/** A GET against the server; `window` adds Plex's paging headers. */
async function api(s, path, params, window) {
  const query = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
  const h = headers(s);
  if (window) {
    h['X-Plex-Container-Start'] = String(window.start);
    h['X-Plex-Container-Size'] = String(window.size);
  }
  const r = await cerumusic.request(`${s.base}${path}${query ? (path.includes('?') ? '&' : '?') + query : ''}`, { headers: h });
  if (r.statusCode === 401) throw new Error('Plex 拒绝了令牌（401），请检查 X-Plex-Token');
  if (r.statusCode < 200 || r.statusCode >= 300) throw new Error(`Plex 返回 HTTP ${r.statusCode}`);
  let body = r.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      throw new Error('Plex 返回的不是 JSON（地址是否指向了网页？）');
    }
  }
  const container = body && body.MediaContainer;
  if (!container) throw new Error('Plex 返回了无效数据');
  return container;
}

/** The music library to use: the named one, else the first. Remembered for a few minutes. */
async function library(s) {
  const cached = cerumusic.storage.get('library');
  if (cached && cached.key === `${s.base}|${s.library}` && Date.now() - cached.at < LIBRARY_TTL_MS) return cached.id;
  const sections = arr((await api(s, '/library/sections', {})).Directory).filter((d) => d.type === 'artist');
  const pick = (s.library && sections.find((d) => d.title === s.library)) || (!s.library && sections[0]);
  if (!pick) throw new Error(s.library ? `没有找到名为“${s.library}”的音乐库` : '服务器上没有音乐库');
  const id = String(pick.key);
  cerumusic.storage.set('library', { key: `${s.base}|${s.library}`, id, at: Date.now() });
  return id;
}

// ─── mapping ───────────────────────────────────────────────
/** Plex serves pictures through its transcoder, scaled; the token rides in the query. */
const thumb = (s, path, size) =>
  path
    ? `${s.base}/photo/:/transcode?width=${size}&height=${size}&minSize=1&upscale=1&url=${enc(path)}&X-Plex-Token=${enc(s.token)}`
    : '';

function song(s, v) {
  const media = arr(v.Media)[0] || {};
  const part = arr(media.Part)[0] || {};
  const codec = String(media.audioCodec || media.container || '').toLowerCase();
  const lossless = ['flac', 'alac', 'wav', 'aiff', 'ape', 'wv'].includes(codec);
  const types = lossless ? ['flac', '320k', '128k'] : num(media.bitrate) >= 300 ? ['320k', '128k'] : ['128k'];
  return {
    songmid: String(v.ratingKey),
    singer: str(v, 'originalTitle') || str(v, 'grandparentTitle'),
    name: str(v, 'title'),
    albumName: str(v, 'parentTitle'),
    albumId: v.parentRatingKey === undefined ? '' : String(v.parentRatingKey),
    singerId: v.grandparentRatingKey === undefined ? undefined : String(v.grandparentRatingKey),
    source: SOURCE,
    interval: playTime(num(v.duration) / 1000),
    img: thumb(s, str(v, 'parentThumb') || str(v, 'thumb') || str(v, 'grandparentThumb'), 300),
    types,
    typeUrl: part.key ? { partKey: String(part.key) } : {},
  };
}

const songs = (s, list) => arr(list).filter((v) => v && v.ratingKey !== undefined).map((v) => song(s, v));

const sizeOf = (c, fallback) => (Number.isFinite(c.totalSize) ? c.totalSize : Number.isFinite(c.size) ? c.size : fallback);

async function trackPage(s, path, params, page, limit) {
  const c = await api(s, path, params, { start: (page - 1) * limit, size: limit });
  const list = songs(s, c.Metadata);
  const total = sizeOf(c, list.length);
  return { list, allPage: pages(total, limit), limit, total, source: SOURCE };
}

const albumItem = (s, a) => ({
  id: `al-${a.ratingKey}`,
  name: str(a, 'title'),
  img: thumb(s, str(a, 'thumb'), 300),
  source: SOURCE,
  desc: a.year ? String(a.year) : '',
  playCount: null,
  author: str(a, 'parentTitle'),
  total: num(a.leafCount),
});

const playlistItem = (s, p) => ({
  id: `pl-${p.ratingKey}`,
  name: str(p, 'title'),
  img: thumb(s, str(p, 'composite'), 300),
  source: SOURCE,
  desc: str(p, 'summary'),
  playCount: null,
  author: '',
  total: num(p.leafCount),
});

// ─── list API ──────────────────────────────────────────────
async function search(_source, { keyword, page, limit }) {
  const s = settings();
  const section = await library(s);
  return trackPage(s, `/library/sections/${section}/search`, { type: 10, query: keyword.trim() }, page, limit);
}

async function searchPlaylist(_source, { keyword, page, limit }) {
  const s = settings();
  const section = await library(s);
  const c = await api(s, `/library/sections/${section}/search`, { type: 9, query: keyword.trim() }, { start: (page - 1) * limit, size: limit });
  const list = arr(c.Metadata).map((a) => albumItem(s, a));
  const total = sizeOf(c, list.length);
  return { list, allPage: pages(total, limit), limit, total, source: SOURCE };
}

/** `al-<id>` is an album, `pl-<id>` a playlist; a bare ID is taken as an album. */
async function playlistDetail(_source, { id, page, limit }) {
  const s = settings();
  id = String(id);
  const playlist = id.startsWith('pl-');
  const bare = id.replace(/^(pl|al)-/, '');
  const window = { start: (page - 1) * limit, size: limit };
  const head = arr((await api(s, playlist ? `/playlists/${enc(bare)}` : `/library/metadata/${enc(bare)}`, {})).Metadata)[0] || {};
  const c = await api(s, playlist ? `/playlists/${enc(bare)}/items` : `/library/metadata/${enc(bare)}/children`, {}, window);
  const list = songs(s, c.Metadata);
  const total = sizeOf(c, list.length);
  return {
    list,
    info: {
      name: str(head, 'title'),
      img: thumb(s, str(head, playlist ? 'composite' : 'thumb'), 480),
      desc: str(head, 'summary'),
      author: playlist ? '' : str(head, 'parentTitle'),
    },
    allPage: pages(total, limit),
    limit,
    total,
    source: SOURCE,
  };
}

const albumDetail = playlistDetail;

async function discoveryCategories() {
  return {
    groups: [
      { name: '专辑', list: ALBUM_KINDS.map(([id, name]) => ({ id, name, source: SOURCE })) },
      { name: '歌单', list: [{ id: 'playlists', name: '服务器歌单', source: SOURCE }] },
    ],
    hot: [
      { id: 'newest', name: '最新添加', source: SOURCE },
      { id: 'frequent', name: '常听专辑', source: SOURCE },
    ],
    source: SOURCE,
  };
}

async function discoveryPlaylists(_source, { category, page }) {
  const s = settings();
  const kind = category === '' ? 'newest' : category;
  const window = { start: (page - 1) * PAGE, size: PAGE };
  let list;
  let total;
  if (kind === 'playlists') {
    const c = await api(s, '/playlists', { playlistType: 'audio' }, window);
    list = arr(c.Metadata).map((p) => playlistItem(s, p));
    total = sizeOf(c, list.length);
  } else {
    const found = ALBUM_KINDS.find(([id]) => id === kind);
    if (!found) throw new Error('无效的专辑分类');
    const section = await library(s);
    const c = await api(s, `/library/sections/${section}/all`, { type: 9, sort: found[2] }, window);
    list = arr(c.Metadata).map((a) => albumItem(s, a));
    total = sizeOf(c, list.length);
  }
  return { list, page, total, has_more: page * PAGE < total, source: SOURCE };
}

async function discoveryCharts() {
  return CHARTS.map(([id, name]) => ({ id, name, img: '', source: SOURCE, update_frequency: '' }));
}

async function chartDetail(_source, { id, page }) {
  const chart = CHARTS.find(([cid]) => cid === id);
  if (!chart) throw new Error('无效榜单参数');
  const s = settings();
  const section = await library(s);
  const result = await trackPage(s, `/library/sections/${section}/all`, { type: 10, sort: chart[2] }, page, PAGE);
  return { ...result, info: { name: chart[1], img: '', desc: '', author: '' } };
}

async function testConnection() {
  const s = settings();
  await api(s, '/library/sections', {});
  await library(s);
  return { success: true };
}

async function getPlaylists(_source, { page, limit }) {
  const s = settings();
  const c = await api(s, '/playlists', { playlistType: 'audio' }, { start: (page - 1) * limit, size: limit });
  const list = arr(c.Metadata).map((p) => playlistItem(s, p));
  const total = sizeOf(c, list.length);
  return { list, allPage: pages(total, limit), limit, total, source: SOURCE };
}

// ─── singer ────────────────────────────────────────────────
async function singerInfo(_source, { id }) {
  const s = settings();
  id = String(id);
  const a = arr((await api(s, `/library/metadata/${enc(id)}`, {})).Metadata)[0] || {};
  const albums = await api(s, `/library/metadata/${enc(id)}/children`, {}, { start: 0, size: 0 });
  const tracks = await api(s, `/library/metadata/${enc(id)}/allLeaves`, {}, { start: 0, size: 0 });
  return {
    id,
    source: SOURCE,
    name: str(a, 'title'),
    desc: str(a, 'summary'),
    avatar: thumb(s, str(a, 'thumb'), 300),
    gender: null,
    musicCount: sizeOf(tracks, 0),
    albumCount: sizeOf(albums, 0),
  };
}

async function singerSongs(_source, { id, page, limit }) {
  const s = settings();
  return trackPage(s, `/library/metadata/${enc(String(id))}/allLeaves`, {}, page, limit);
}

async function singerAlbums(_source, { id, page, limit }) {
  const s = settings();
  const c = await api(s, `/library/metadata/${enc(String(id))}/children`, {}, { start: (page - 1) * limit, size: limit });
  const list = arr(c.Metadata).map((a) => ({
    id: `al-${a.ratingKey}`,
    count: num(a.leafCount),
    name: str(a, 'title'),
    author: str(a, 'parentTitle'),
    img: thumb(s, str(a, 'thumb'), 300),
    desc: null,
  }));
  const total = sizeOf(c, list.length);
  return { list, allPage: pages(total, limit), limit, total, source: SOURCE };
}

// ─── playback / download ───────────────────────────────────
const BITRATE = { '128k': 128, '320k': 320 };

async function partKey(s, item) {
  const known = item && item.typeUrl && item.typeUrl.partKey;
  if (typeof known === 'string' && known.startsWith('/')) return known;
  const id = String((item && item.songmid) || '');
  if (!id || id.length > 128) throw new Error('无效歌曲 ID');
  const v = arr((await api(s, `/library/metadata/${enc(id)}`, {})).Metadata)[0] || {};
  const key = str(arr(arr(v.Media)[0] && arr(v.Media)[0].Part)[0], 'key');
  if (!key) throw new Error('这首歌没有可播放的文件');
  return key;
}

async function streamUrl(item, quality, download) {
  const s = settings();
  const id = String((item && item.songmid) || '');
  if (!id || id.length > 128) throw new Error('缺少歌曲 ID');
  if (BITRATE[quality]) {
    // Lower qualities go through Plex's transcoder, as MP3.
    const q = {
      path: `/library/metadata/${id}`,
      mediaIndex: 0,
      partIndex: 0,
      protocol: 'http',
      directPlay: 0,
      directStream: 0,
      maxAudioBitrate: BITRATE[quality],
      audioBitrate: BITRATE[quality],
      'X-Plex-Token': s.token,
      'X-Plex-Client-Identifier': clientId(),
      'X-Plex-Product': 'Mio Music',
      'X-Plex-Platform': 'Mio',
    };
    return `${s.base}/music/:/transcode/universal/start.mp3?${Object.entries(q).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&')}`;
  }
  const key = await partKey(s, item);
  return `${s.base}${key}?${download ? 'download=1&' : ''}X-Plex-Token=${enc(s.token)}`;
}

const musicUrl = (_source, { song: item, quality }) => streamUrl(item, quality, false);
const downloadUrl = (_source, { song: item, quality }) => streamUrl(item, quality, true);

async function cover(_source, { song: item }) {
  if (item && typeof item.img === 'string' && item.img) return item.img;
  const id = String((item && item.songmid) || '');
  if (!id || id.length > 128) throw new Error('无效歌曲 ID');
  const s = settings();
  const v = arr((await api(s, `/library/metadata/${enc(id)}`, {})).Metadata)[0] || {};
  return thumb(s, str(v, 'parentThumb') || str(v, 'thumb') || str(v, 'grandparentThumb'), 300);
}

module.exports = {
  listPlugin: {
    cover,
    name: 'Plex（列表）',
    version: '1.0.0',
    author: 'Mio Music',
    description: 'Plex Media Server 的音乐库：搜索、专辑与歌单、最近添加/常听歌曲、歌手，并由本插件提供播放与下载。',
    config: [
      { key: 'baseUrl', label: '服务器地址', type: 'text', required: true, placeholder: 'http://192.168.1.2:32400', description: '服务器根地址，默认端口 32400' },
      { key: 'token', label: 'Plex 令牌', type: 'password', required: true, description: 'X-Plex-Token：在 Plex 网页中打开任一媒体 → 获取信息 → 查看 XML，地址末尾的 X-Plex-Token' },
      { key: 'library', label: '音乐库名称', type: 'text', placeholder: '留空使用第一个音乐库', description: '有多个音乐库时填写要使用的库名' },
      { key: 'allowHttp', label: '允许 HTTP（不加密）', type: 'switch', default: false, description: '回环地址（localhost）无需勾选' },
    ],
    defaults: { play: true, download: true },
    sources: {
      plex: {
        name: 'Plex',
        icon: '🎵',
        capabilities: ['search', 'searchPlaylist', 'playlistDetail', 'albumDetail', 'discovery', 'singer', 'play', 'download', 'testConnection', 'userPlaylists', 'cover'],
        qualities: ['128k', '320k', 'flac'],
      },
    },
    search,
    searchPlaylist,
    testConnection,
    getPlaylists,
    playlistDetail,
    albumDetail,
    discoveryCategories,
    discoveryPlaylists,
    discoveryCharts,
    chartDetail,
    singerInfo,
    singerSongs,
    singerAlbums,
    musicUrl,
    downloadUrl,
  },
};
