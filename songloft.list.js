/**
 * @name Songloft（列表）
 * @version 1.1.0
 * @author Mio Music
 * @description Songloft 个人音乐服务器：搜索、专辑/歌手/流派与歌单、歌词，并由本插件提供播放与下载地址。
 *
 * Music-list plugin for the Mio Music GPUI host (source ID `songloft`), over Songloft's REST API
 * (`/api/v1`, JWT login). The login is cached in the plugin's own store and refreshed with the
 * refresh token. Songloft has no album or artist objects of its own: albums, artists and genres
 * are the server's song facets, and a facet's songs are the songs with that exact value.
 */

/**
 * Text follows the host's language: `cerumusic.locale` is `zh-CN` or `en-US`, and Chinese is the
 * fallback for a host that does not provide it. `tr(zh, en)` picks one. The plugin `name` stays
 * Chinese on purpose: the host identifies an installed plugin by it.
 */
const EN = typeof cerumusic.locale === 'string' && !/^zh/i.test(cerumusic.locale);
const tr = (zh, en) => (EN ? en : zh);
const SOURCE = 'songloft';
const PAGE = 30;
const SKEW_MS = 60 * 1000;

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
  const username = String(c.username || '').trim();
  const password = String(c.password || '');
  if (!baseUrl || !username || !password) {
    throw new Error(tr('请先在插件“配置”中填写服务器地址、用户名和密码', 'Enter the server address, username and password under the plugin\'s "Configure" first'));
  }
  const m = /^(https?):\/\/([^\/?#@]+)(\/[^?#]*)?$/i.exec(baseUrl);
  if (!m) throw new Error(tr('服务器地址无效', 'Invalid server address'));
  const loopback = /^(localhost|127(\.\d{1,3}){3}|\[::1\])(:\d+)?$/i.test(m[2]);
  if (m[1].toLowerCase() === 'http' && !loopback && c.allowHttp !== true) {
    throw new Error(tr('HTTP 服务器需要在配置中勾选“允许 HTTP（不加密）”', 'HTTP servers need "Allow HTTP (unencrypted)" turned on in the configuration'));
  }
  let path = (m[3] || '').replace(/\/+$/, '');
  if (path.endsWith('/api/v1')) path = path.slice(0, -7);
  return { api: `${m[1].toLowerCase()}://${m[2]}${path}/api/v1`, username, password };
}

const sessionKey = (s) => `${s.api}|${s.username}|${cerumusic.utils.crypto.md5(s.password)}`;

function fail(r, what) {
  const detail = r.body && typeof r.body === 'object' ? str(r.body, 'error') : '';
  return new Error(tr(
    `Songloft ${what}失败（HTTP ${r.statusCode}）${detail ? '：' + detail : ''}`,
    `Songloft ${what} failed (HTTP ${r.statusCode})${detail ? ': ' + detail : ''}`,
  ));
}

function remember(s, data, previous) {
  const seconds = num(data.expires_in) || 3600;
  const session = {
    key: sessionKey(s),
    access: String(data.access_token),
    refresh: String(data.refresh_token || (previous && previous.refresh) || ''),
    // Renewed a little before it runs out (but never for the whole life of a short-lived token).
    expiresAt: Date.now() + seconds * 1000 - Math.min(SKEW_MS, seconds * 500),
  };
  cerumusic.storage.set('session', session);
  return session;
}

async function login(s) {
  const r = await cerumusic.request(`${s.api}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: s.username, password: s.password }),
  });
  if (r.statusCode === 401) throw new Error(tr('Songloft 登录失败：用户名或密码错误', 'Songloft login failed: wrong username or password'));
  if (r.statusCode < 200 || r.statusCode >= 300) throw fail(r, tr('登录', 'login'));
  if (!r.body || typeof r.body !== 'object' || !r.body.access_token) {
    throw new Error(tr('Songloft 返回了无效数据（地址是否指向了网页？）', 'Songloft returned invalid data (does the address point to a web page?)'));
  }
  return remember(s, r.body, null);
}

async function refresh(s, previous) {
  if (!previous || !previous.refresh) return login(s);
  const r = await cerumusic.request(`${s.api}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refresh_token: previous.refresh }),
  });
  if (r.statusCode >= 200 && r.statusCode < 300 && r.body && r.body.access_token) return remember(s, r.body, previous);
  return login(s);
}

async function session(s) {
  const cached = cerumusic.storage.get('session');
  if (!cached || cached.key !== sessionKey(s)) return login(s);
  if (cached.expiresAt > Date.now()) return cached;
  return refresh(s, cached);
}

/** A GET against the API; a rejected token is renewed once. */
async function get(s, path, params) {
  const query = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
  let sess = await session(s);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const r = await cerumusic.request(`${s.api}${path}${query ? '?' + query : ''}`, {
      headers: { Authorization: `Bearer ${sess.access}`, Accept: 'application/json' },
    });
    if (r.statusCode === 401 && attempt === 0) {
      sess = await login(s);
      continue;
    }
    if (r.statusCode === 404) {
      const e = new Error(tr('Songloft 中没有找到对应内容', 'Not found on Songloft'));
      e.notFound = true;
      throw e;
    }
    if (r.statusCode < 200 || r.statusCode >= 300) throw fail(r, tr('请求', 'request'));
    if (typeof r.body === 'string') {
      try {
        return { data: JSON.parse(r.body), sess };
      } catch (_) {
        throw new Error(tr('Songloft 返回的不是 JSON（地址是否指向了网页？）', 'Songloft did not return JSON (does the address point to a web page?)'));
      }
    }
    return { data: r.body, sess };
  }
  throw new Error(tr('Songloft 请求失败', 'Songloft request failed'));
}

/** Media and picture URLs carry the access token in the query, which Songloft accepts there. */
const media = (s, sess, path, params) => {
  const q = Object.entries({ ...(params || {}), access_token: sess.access })
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
  return `${s.api}${path}?${q}`;
};

// ─── mapping ───────────────────────────────────────────────
/** A server-relative cover path (`/api/v1/songs/7/cover?v=…`) rebuilt on the configured base. */
function coverOf(s, sess, relative, size) {
  const m = /\/(songs|playlists)\/(\d+)\/cover/.exec(relative || '');
  return m ? media(s, sess, `/${m[1]}/${m[2]}/cover`, { w: size }) : '';
}

function song(s, sess, v) {
  const format = str(v, 'format').toLowerCase();
  const lossless = ['flac', 'alac', 'wav', 'aiff', 'ape', 'wv'].includes(format);
  const types = lossless ? ['flac', '320k', '128k'] : num(v.bit_rate) >= 300 ? ['320k', '128k'] : ['128k'];
  return {
    songmid: String(v.id),
    singer: str(v, 'artist'),
    name: str(v, 'title'),
    albumName: str(v, 'album'),
    albumId: str(v, 'album'),
    singerId: str(v, 'artist') || undefined,
    source: SOURCE,
    interval: playTime(num(v.duration)),
    img: coverOf(s, sess, str(v, 'cover_url'), 300),
    types,
    typeUrl: {},
  };
}

const songs = (s, sess, list) =>
  arr(list)
    .filter((v) => v && v.id !== undefined && v.id !== null)
    .map((v) => song(s, sess, v));

async function songPage(path, params, page, limit) {
  const s = settings();
  const { data, sess } = await get(s, path, { ...params, limit, offset: (page - 1) * limit });
  const total = num(data.total);
  return { list: songs(s, sess, data.songs), allPage: pages(total, limit), limit, total, source: SOURCE };
}

const playlistItem = (s, sess, p) => ({
  id: `pl-${p.id}`,
  name: str(p, 'name'),
  img: coverOf(s, sess, str(p, 'cover_url'), 300),
  source: SOURCE,
  desc: str(p, 'description'),
  playCount: null,
  author: '',
  total: num(p.song_count),
});

/** The facet kinds discovery offers: id prefix → [song filter, group title]. */
const FACETS = { al: ['album', tr('专辑', 'Albums')], ar: ['artist', tr('歌手', 'Artists')], ge: ['genre', tr('流派', 'Genres')] };

// ─── list API ──────────────────────────────────────────────
async function search(_source, { keyword, page, limit }) {
  return songPage('/songs', { keyword: keyword.trim() }, page, limit);
}

async function searchPlaylist(_source, { keyword, page, limit }) {
  const s = settings();
  const { data, sess } = await get(s, '/playlists', { type: 'normal', keyword: keyword.trim(), limit, offset: (page - 1) * limit });
  const total = num(data.total);
  return { list: arr(data.playlists).map((p) => playlistItem(s, sess, p)), allPage: pages(total, limit), limit, total, source: SOURCE };
}

/** `pl-<id>` is a playlist; `al-`/`ar-`/`ge-` hold an album, artist or genre name. */
async function playlistDetail(_source, { id, page, limit }) {
  const s = settings();
  id = String(id);
  const prefix = id.slice(0, 3);
  const rest = id.slice(3);
  if (prefix === 'pl-') {
    const { data: head, sess } = await get(s, `/playlists/${enc(rest)}`, {});
    const result = await songPage(`/playlists/${enc(rest)}/songs`, {}, page, limit);
    return {
      ...result,
      info: { name: str(head, 'name'), img: coverOf(s, sess, str(head, 'cover_url'), 480), desc: str(head, 'description'), author: '' },
    };
  }
  const facet = FACETS[id.slice(0, 2)] && id[2] === '-' ? FACETS[id.slice(0, 2)] : FACETS.al;
  const value = FACETS[id.slice(0, 2)] && id[2] === '-' ? id.slice(3) : id;
  const result = await songPage('/songs', { [facet[0]]: value, sort: 'title', order: 'asc' }, page, limit);
  const author = result.list.length ? result.list[0].singer : '';
  const first = result.list[0];
  return { ...result, info: { name: value, img: first ? first.img : '', desc: '', author: facet[0] === 'album' ? author : '' } };
}

const albumDetail = playlistDetail;

async function discoveryCategories() {
  return {
    groups: [
      { name: tr('音乐库', 'Library'), list: [
        { id: 'albums', name: tr('专辑', 'Albums'), source: SOURCE },
        { id: 'artists', name: tr('歌手', 'Artists'), source: SOURCE },
        { id: 'genres', name: tr('流派', 'Genres'), source: SOURCE },
      ] },
      { name: tr('歌单', 'Playlists'), list: [{ id: 'playlists', name: tr('服务器歌单', 'Server playlists'), source: SOURCE }] },
    ],
    hot: [
      { id: 'albums', name: tr('专辑', 'Albums'), source: SOURCE },
      { id: 'playlists', name: tr('服务器歌单', 'Server playlists'), source: SOURCE },
    ],
    source: SOURCE,
  };
}

async function discoveryPlaylists(_source, { category, page }) {
  const s = settings();
  const kind = category === '' ? 'albums' : category;
  const window = { limit: PAGE, offset: (page - 1) * PAGE };
  if (kind === 'playlists') {
    const { data, sess } = await get(s, '/playlists', { type: 'normal', ...window });
    const total = num(data.total);
    return { list: arr(data.playlists).map((p) => playlistItem(s, sess, p)), page, total, has_more: page * PAGE < total, source: SOURCE };
  }
  const field = { albums: 'album', artists: 'artist', genres: 'genre' }[kind];
  if (!field) throw new Error(tr('无效的分类', 'Invalid category'));
  const prefix = { albums: 'al', artists: 'ar', genres: 'ge' }[kind];
  const { data, sess } = await get(s, '/songs/facets', { field, sort: 'name', order: 'asc', ...window });
  const list = arr(data.facets)
    .filter((f) => f && typeof f.value === 'string' && f.value)
    .map((f) => ({
      id: `${prefix}-${f.value}`,
      name: f.value,
      img: coverOf(s, sess, str(f, 'cover_url'), 300),
      source: SOURCE,
      desc: '',
      playCount: null,
      author: '',
      total: num(f.count),
    }));
  const total = num(data.total);
  return { list, page, total, has_more: page * PAGE < total, source: SOURCE };
}

const CHARTS = [
  ['newest', tr('最近添加', 'Recently added'), { sort: 'added_at', order: 'desc' }],
  ['random', tr('随机歌曲', 'Random songs'), null],
  ['longest', tr('最长歌曲', 'Longest songs'), { sort: 'duration', order: 'desc' }],
];

async function discoveryCharts() {
  return CHARTS.map(([id, name]) => ({ id, name, img: '', source: SOURCE, update_frequency: '' }));
}

async function chartDetail(_source, { id, page }) {
  const chart = CHARTS.find(([cid]) => cid === id);
  if (!chart) throw new Error(tr('无效榜单参数', 'Invalid chart parameter'));
  const info = { name: chart[1], img: '', desc: '', author: '' };
  if (id === 'random') {
    // A random batch has no stable pages: serve one.
    const s = settings();
    const { data, sess } = await get(s, '/songs/random', { limit: PAGE });
    const list = songs(s, sess, data.songs);
    return { list, info, allPage: 1, limit: PAGE, total: list.length, source: SOURCE };
  }
  return { ...(await songPage('/songs', chart[2], page, PAGE)), info };
}

async function testConnection() {
  const s = settings();
  cerumusic.storage.remove('session');
  await login(s);
  return { success: true };
}

async function getPlaylists(_source, { page, limit }) {
  return searchPlaylist(_source, { keyword: '', page, limit });
}

// ─── singer ────────────────────────────────────────────────
async function singerInfo(_source, { id }) {
  const s = settings();
  id = String(id);
  const { data, sess } = await get(s, '/songs', { artist: id, limit: 500, offset: 0 });
  const rows = arr(data.songs);
  const first = rows.find((v) => str(v, 'cover_url'));
  return {
    id,
    source: SOURCE,
    name: id,
    desc: '',
    avatar: first ? coverOf(s, sess, str(first, 'cover_url'), 300) : '',
    gender: null,
    musicCount: num(data.total),
    // Counted from the first 500 songs: Songloft has no album listing per artist.
    albumCount: new Set(rows.map((v) => str(v, 'album')).filter(Boolean)).size,
  };
}

async function singerSongs(_source, { id, page, limit }) {
  return songPage('/songs', { artist: String(id), sort: 'album', order: 'asc' }, page, limit);
}

/** The artist's albums, grouped from their songs (up to the first 500). */
async function singerAlbums(_source, { id, page, limit }) {
  const s = settings();
  const { data, sess } = await get(s, '/songs', { artist: String(id), limit: 500, offset: 0, sort: 'album', order: 'asc' });
  const groups = new Map();
  for (const v of arr(data.songs)) {
    const name = str(v, 'album');
    if (!name) continue;
    const g = groups.get(name) || { count: 0, first: v };
    g.count += 1;
    groups.set(name, g);
  }
  const all = [...groups.entries()];
  const list = all.slice((page - 1) * limit, page * limit).map(([name, g]) => ({
    id: `al-${name}`,
    count: g.count,
    name,
    author: str(g.first, 'artist'),
    img: coverOf(s, sess, str(g.first, 'cover_url'), 300),
    desc: null,
  }));
  return { list, allPage: pages(all.length, limit), limit, total: all.length, source: SOURCE };
}

// ─── lyrics ────────────────────────────────────────────────
async function lyrics(_source, { song: item }) {
  const s = settings();
  const id = String((item && item.songmid) || '');
  if (!/^\d+$/.test(id)) throw new Error(tr('无效歌曲 ID', 'Invalid song ID'));
  let data;
  try {
    data = (await get(s, `/songs/${id}/lyric`, {})).data;
  } catch (e) {
    if (e.notFound) throw new Error(tr('没有找到歌词', 'No lyrics found'));
    throw e;
  }
  const lyric = str(data, 'lyric');
  if (!lyric.trim()) throw new Error(tr('没有找到歌词', 'No lyrics found'));
  return { lyric, tlyric: str(data, 'tlyric'), rlyric: str(data, 'rlyric'), crlyric: str(data, 'lxlyric'), source: SOURCE };
}

// ─── playback / download ───────────────────────────────────
const BITRATE = { '128k': 128, '320k': 320 };

async function playUrl(_source, { song: item, quality }) {
  const s = settings();
  const id = String((item && item.songmid) || '');
  if (!/^\d+$/.test(id)) throw new Error(tr('缺少歌曲 ID', 'Missing song ID'));
  const sess = await session(s);
  // Lower qualities are transcoded to MP3; lossless is the original file.
  return media(s, sess, `/songs/${id}/play`, BITRATE[quality] ? { format: 'mp3', quality: BITRATE[quality] } : {});
}

async function cover(_source, { song: item }) {
  if (item && typeof item.img === 'string' && item.img) return item.img;
  const s = settings();
  const id = String((item && item.songmid) || '');
  if (!/^\d+$/.test(id)) throw new Error(tr('无效歌曲 ID', 'Invalid song ID'));
  const { data, sess } = await get(s, `/songs/${id}`, {});
  return coverOf(s, sess, str(data, 'cover_url'), 300);
}

module.exports = {
  listPlugin: {
    cover,
    lyrics,
    name: 'Songloft（列表）',
    displayName: tr('Songloft（列表）', 'Songloft (List)'),
    version: '1.1.0',
    author: 'Mio Music',
    description: tr(
      'Songloft 个人音乐服务器：搜索、专辑/歌手/流派与歌单、歌词，并由本插件提供播放与下载。',
      'Songloft personal music server: search, albums/artists/genres and playlists, lyrics, with playback and download provided by this plugin.',
    ),
    config: [
      { key: 'baseUrl', label: tr('服务器地址', 'Server address'), type: 'text', required: true, placeholder: 'http://192.168.1.2:58091', description: tr('服务器根地址，默认端口 58091；使用反向代理子路径时包含该路径', 'Server root, default port 58091; include the sub-path when behind a reverse proxy') },
      { key: 'username', label: tr('用户名', 'Username'), type: 'text', required: true, description: tr('默认管理员为 admin', 'The default administrator is admin') },
      { key: 'password', label: tr('密码', 'Password'), type: 'password', required: true },
      { key: 'allowHttp', label: tr('允许 HTTP（不加密）', 'Allow HTTP (unencrypted)'), type: 'switch', default: false, description: tr('回环地址（localhost）无需勾选', 'Not needed for loopback addresses (localhost)') },
    ],
    defaults: { play: true, download: true },
    sources: {
      songloft: {
        name: 'Songloft',
        icon: '🎵',
        capabilities: ['search', 'searchPlaylist', 'playlistDetail', 'albumDetail', 'discovery', 'singer', 'lyrics', 'play', 'download', 'testConnection', 'userPlaylists', 'cover'],
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
    musicUrl: playUrl,
    downloadUrl: playUrl,
  },
};
