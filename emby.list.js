/**
 * @name Emby（列表）
 * @version 1.1.0
 * @author Mio Music
 * @description Emby 媒体服务器的音乐库：搜索、专辑与歌单、随机/收藏/常听歌曲、歌手，并由本插件提供播放与下载地址。
 *
 * Music-list plugin for the Mio Music GPUI host (source ID `emby`). Server address and
 * account are set in the configuration form; an access key may replace the password. The verified
 * login is kept in the plugin's own store. Jellyfin shares this API: `jellyfin.list.js` differs only in
 * the FLAVOR block below.
 */

/**
 * Text follows the host's language: `cerumusic.locale` is `zh-CN` or `en-US`, and Chinese is the
 * fallback for a host that does not provide it. `tr(zh, en)` picks one. The plugin `name` stays
 * Chinese on purpose: the host identifies an installed plugin by it.
 */
const EN = typeof cerumusic.locale === 'string' && !/^zh/i.test(cerumusic.locale);
const tr = (zh, en) => (EN ? en : zh);
// ─── flavor ────────────────────────────────────────────────
const FLAVOR = 'emby';
const EMBY = FLAVOR === 'emby';
const SOURCE = FLAVOR;
const LABEL = EMBY ? 'Emby' : 'Jellyfin';
const PREFIX = EMBY ? '/emby' : '';

const PAGE = 30;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const TICKS = 10000000;
const ALBUM_KINDS = [
  ['newest', tr('最新添加', 'Recently added'), 'DateCreated', 'Descending', ''],
  ['recent', tr('最近播放', 'Recently played'), 'DatePlayed', 'Descending', 'IsPlayed'],
  ['frequent', tr('常听专辑', 'Most played'), 'PlayCount', 'Descending', 'IsPlayed'],
  ['random', tr('随机专辑', 'Random albums'), 'Random', 'Ascending', ''],
  ['starred', tr('我的收藏', 'My favorites'), 'SortName', 'Ascending', 'IsFavorite'],
  ['alphabeticalByName', tr('按名称', 'By name'), 'SortName', 'Ascending', ''],
];

const str = (o, k) => (o !== null && typeof o === 'object' && typeof o[k] === 'string' ? o[k] : '');
const num = (v) => (Number.isFinite(v) ? v : 0);
const arr = (v) => (Array.isArray(v) ? v : []);
const playTime = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const pages = (total, limit) => Math.ceil(total / limit);
const enc = (s) => encodeURIComponent(String(s));
const rand = (n) => {
  let out = '';
  for (let i = 0; i < n; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
};

// ─── configuration ─────────────────────────────────────────
function settings() {
  const c = cerumusic.config || {};
  const baseUrl = String(c.baseUrl || '').trim();
  const username = String(c.username || '').trim();
  const password = String(c.password || '');
  const apiKey = String(c.apiKey || '').trim();
  if (!baseUrl || (!apiKey && !username)) {
    throw new Error(tr('请先在插件“配置”中填写服务器地址，以及用户名和密码（或访问密钥）', 'Enter the server address and a username and password (or an API key) under the plugin\'s "Configure" first'));
  }
  const m = /^(https?):\/\/([^\/?#@]+)(\/[^?#]*)?$/i.exec(baseUrl);
  if (!m) throw new Error(tr('服务器地址无效', 'Invalid server address'));
  const loopback = /^(localhost|127(\.\d{1,3}){3}|\[::1\])(:\d+)?$/i.test(m[2]);
  if (m[1].toLowerCase() === 'http' && !loopback && c.allowHttp !== true) {
    throw new Error(tr('HTTP 服务器需要在配置中勾选“允许 HTTP（不加密）”', 'HTTP servers need "Allow HTTP (unencrypted)" turned on in the configuration'));
  }
  let path = (m[3] || '').replace(/\/+$/, '');
  if (EMBY && path.endsWith('/emby')) path = path.slice(0, -5);
  return {
    base: `${m[1].toLowerCase()}://${m[2]}${path}${PREFIX}`,
    username,
    password,
    apiKey,
    clientName: String(c.clientName || '').trim() || 'Mio',
  };
}

const sessionKey = (s) => `${s.base}|${s.username}|${cerumusic.utils.crypto.md5(s.password + s.apiKey)}`;

function deviceId() {
  let id = cerumusic.storage.get('deviceId');
  if (typeof id !== 'string' || !id) {
    id = 'mio-' + rand(24);
    cerumusic.storage.set('deviceId', id);
  }
  return id;
}

/** The client identification header every request carries; the token joins it once known. */
function identity(s, token) {
  const parts = `Client="${s.clientName}", Device="Mio Music", DeviceId="${deviceId()}", Version="1.0"`;
  if (EMBY) {
    return { 'X-Emby-Authorization': `MediaBrowser ${parts}`, ...(token ? { 'X-Emby-Token': token } : {}) };
  }
  return { Authorization: `MediaBrowser ${parts}${token ? `, Token="${token}"` : ''}` };
}

function parse(r, what) {
  let body = r.body;
  if (typeof body === 'string' && body) {
    try {
      body = JSON.parse(body);
    } catch (_) {
      throw new Error(tr(`${LABEL} 返回的不是 JSON（地址是否指向了网页？）`, `${LABEL} did not return JSON (does the address point to a web page?)`));
    }
  }
  if (r.statusCode === 401 || r.statusCode === 403) {
    const e = new Error(tr(`${LABEL} 拒绝了请求（${what}），请检查账号或访问密钥`, `${LABEL} rejected the request (${what}); check the account or API key`));
    e.auth = true;
    throw e;
  }
  if (r.statusCode < 200 || r.statusCode >= 300) throw new Error(tr(`${LABEL} 返回 HTTP ${r.statusCode}`, `${LABEL} returned HTTP ${r.statusCode}`));
  return body;
}

/** Signs in (or adopts the access key) and remembers the session. */
async function login(s) {
  if (s.apiKey) {
    // An access key has no user of its own: borrow the configured user, else the first one.
    const r = await cerumusic.request(`${s.base}/Users`, { headers: { ...identity(s, s.apiKey), Accept: 'application/json' } });
    const users = arr(parse(r, 'Users'));
    const user = users.find((u) => u.Name === s.username) || users[0];
    if (!user) throw new Error(tr(`${LABEL} 没有可用的用户`, `${LABEL} has no usable user`));
    const session = { key: sessionKey(s), token: s.apiKey, userId: String(user.Id), verifiedAt: Date.now() };
    cerumusic.storage.set('session', session);
    return session;
  }
  const r = await cerumusic.request(`${s.base}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: { ...identity(s, ''), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ Username: s.username, Pw: s.password }),
  });
  if (r.statusCode === 401 || r.statusCode === 400) throw new Error(tr(`${LABEL} 登录失败：用户名或密码错误`, `${LABEL} login failed: wrong username or password`));
  const data = parse(r, 'login');
  if (!data || !data.AccessToken || !data.User) throw new Error(tr(`${LABEL} 登录返回了无效数据`, `${LABEL} login returned invalid data`));
  const session = { key: sessionKey(s), token: String(data.AccessToken), userId: String(data.User.Id), verifiedAt: Date.now() };
  cerumusic.storage.set('session', session);
  return session;
}

async function session(s) {
  const cached = cerumusic.storage.get('session');
  if (cached && cached.key === sessionKey(s) && Date.now() - cached.verifiedAt < SESSION_TTL_MS) return cached;
  return login(s);
}

/** A GET against the API, signing in again once when the saved login was rejected. */
async function api(s, path, params) {
  const query = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sess = attempt === 0 ? await session(s) : await login(s);
    const r = await cerumusic.request(`${s.base}${path}${query ? '?' + query : ''}`, {
      headers: { ...identity(s, sess.token), Accept: 'application/json' },
    });
    try {
      return { data: parse(r, path), sess };
    } catch (e) {
      if (!e.auth || attempt === 1) {
        if (e.auth) cerumusic.storage.remove('session');
        throw e;
      }
    }
  }
  throw new Error(tr(`${LABEL} 请求失败`, `${LABEL} request failed`));
}

/**
 * URL of a media or image resource; the access token rides in the query. Jellyfin 12 accepts
 * `ApiKey` on every route but `api_key` only on some (its universal audio route rejects it).
 */
const media = (s, sess, path, params) => {
  const q = Object.entries({ ...(params || {}), [EMBY ? 'api_key' : 'ApiKey']: sess.token })
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
  return `${s.base}${path}?${q}`;
};

// ─── mapping ───────────────────────────────────────────────
const FIELDS = 'MediaSources,ParentId';

function image(s, sess, item, size) {
  const own = item.ImageTags && item.ImageTags.Primary;
  if (own) return media(s, sess, `/Items/${item.Id}/Images/Primary`, { maxWidth: size, quality: 90, tag: own });
  if (item.AlbumId && item.AlbumPrimaryImageTag) {
    return media(s, sess, `/Items/${item.AlbumId}/Images/Primary`, { maxWidth: size, quality: 90, tag: item.AlbumPrimaryImageTag });
  }
  if (item.ParentPrimaryImageItemId && item.ParentPrimaryImageTag) {
    return media(s, sess, `/Items/${item.ParentPrimaryImageItemId}/Images/Primary`, { maxWidth: size, quality: 90, tag: item.ParentPrimaryImageTag });
  }
  return '';
}

function song(s, sess, v) {
  const source = arr(v.MediaSources)[0] || {};
  const container = String(source.Container || v.Container || '').toLowerCase();
  const lossless = ['flac', 'alac', 'wav', 'aiff', 'ape', 'wv'].includes(container);
  const kbps = num(source.Bitrate) / 1000;
  const types = lossless ? ['flac', '320k', '128k'] : kbps >= 300 ? ['320k', '128k'] : ['128k'];
  const artists = arr(v.Artists).filter((a) => typeof a === 'string' && a);
  const first = arr(v.ArtistItems)[0];
  return {
    songmid: String(v.Id),
    singer: artists.length ? artists.join(' / ') : str(v, 'AlbumArtist'),
    name: str(v, 'Name'),
    albumName: str(v, 'Album'),
    albumId: v.AlbumId === undefined ? '' : String(v.AlbumId),
    singerId: first && first.Id ? String(first.Id) : undefined,
    source: SOURCE,
    interval: playTime(num(v.RunTimeTicks) / TICKS),
    img: image(s, sess, v, 300),
    types,
    typeUrl: {},
  };
}

const songs = (s, sess, list) =>
  arr(list)
    .filter((v) => v && v.Id)
    .map((v) => song(s, sess, v));

const trackQuery = (sess, extra) => ({
  UserId: sess.userId,
  IncludeItemTypes: 'Audio',
  Recursive: true,
  Fields: FIELDS,
  EnableTotalRecordCount: true,
  ...extra,
});

async function trackPage(s, extra, page, limit) {
  const { data, sess } = await api(s, '/Items', trackQuery(await session(s), { StartIndex: (page - 1) * limit, Limit: limit, ...extra }));
  const total = num(data.TotalRecordCount);
  return { list: songs(s, sess, data.Items), allPage: pages(total, limit), limit, total, source: SOURCE };
}

const albumItem = (s, sess, a) => ({
  id: `al-${a.Id}`,
  name: str(a, 'Name'),
  img: image(s, sess, a, 300),
  source: SOURCE,
  desc: a.ProductionYear ? String(a.ProductionYear) : '',
  playCount: null,
  author: str(a, 'AlbumArtist') || arr(a.AlbumArtists).map((x) => x.Name).join(' / '),
  total: num(a.ChildCount),
});

const playlistItem = (s, sess, p) => ({
  id: `pl-${p.Id}`,
  name: str(p, 'Name'),
  img: image(s, sess, p, 300),
  source: SOURCE,
  desc: str(p, 'Overview'),
  playCount: null,
  author: '',
  total: num(p.ChildCount),
});

// ─── list API ──────────────────────────────────────────────
async function search(_source, { keyword, page, limit }) {
  return trackPage(await settingsReady(), { SearchTerm: keyword.trim() }, page, limit);
}

async function settingsReady() {
  const s = settings();
  await session(s);
  return s;
}

async function searchPlaylist(_source, { keyword, page, limit }) {
  const s = await settingsReady();
  const sess = await session(s);
  const { data } = await api(s, '/Items', {
    UserId: sess.userId,
    IncludeItemTypes: 'MusicAlbum,Playlist',
    Recursive: true,
    SearchTerm: keyword.trim(),
    StartIndex: (page - 1) * limit,
    Limit: limit,
    Fields: 'ChildCount,ProductionYear,AlbumArtists,Overview',
    EnableTotalRecordCount: true,
  });
  const list = arr(data.Items).map((it) => (it.Type === 'Playlist' ? playlistItem(s, sess, it) : albumItem(s, sess, it)));
  const total = num(data.TotalRecordCount);
  return { list, allPage: pages(total, limit), limit, total, source: SOURCE };
}

/** `al-<id>` is an album, `pl-<id>` a playlist; a bare ID is taken as an album. */
async function playlistDetail(_source, { id, page, limit }) {
  const s = await settingsReady();
  const sess = await session(s);
  id = String(id);
  const playlist = id.startsWith('pl-');
  const bare = id.replace(/^(pl|al)-/, '');
  const head = (await api(s, `/Users/${sess.userId}/Items/${enc(bare)}`, {})).data || {};
  const info = {
    name: str(head, 'Name'),
    img: image(s, sess, head, 480),
    desc: str(head, 'Overview'),
    author: str(head, 'AlbumArtist'),
  };
  let result;
  if (playlist) {
    const { data } = await api(s, `/Playlists/${enc(bare)}/Items`, {
      UserId: sess.userId, StartIndex: (page - 1) * limit, Limit: limit, Fields: FIELDS, EnableTotalRecordCount: true,
    });
    const total = num(data.TotalRecordCount);
    result = { list: songs(s, sess, data.Items), total };
  } else {
    const { data } = await api(s, '/Items', trackQuery(sess, {
      ParentId: bare, StartIndex: (page - 1) * limit, Limit: limit, SortBy: 'ParentIndexNumber,IndexNumber,SortName',
    }));
    result = { list: songs(s, sess, data.Items), total: num(data.TotalRecordCount) };
  }
  return { list: result.list, info, allPage: pages(result.total, limit), limit, total: result.total, source: SOURCE };
}

const albumDetail = playlistDetail;

async function discoveryCategories() {
  return {
    groups: [
      { name: tr('专辑', 'Albums'), list: ALBUM_KINDS.map(([id, name]) => ({ id, name, source: SOURCE })) },
      { name: tr('歌单', 'Playlists'), list: [{ id: 'playlists', name: tr('服务器歌单', 'Server playlists'), source: SOURCE }] },
    ],
    hot: [
      { id: 'newest', name: tr('最新添加', 'Recently added'), source: SOURCE },
      { id: 'random', name: tr('随机专辑', 'Random albums'), source: SOURCE },
    ],
    source: SOURCE,
  };
}

async function discoveryPlaylists(_source, { category, page }) {
  const s = await settingsReady();
  const sess = await session(s);
  const kind = category === '' ? 'newest' : category;
  const base = { UserId: sess.userId, Recursive: true, StartIndex: (page - 1) * PAGE, Limit: PAGE, EnableTotalRecordCount: true };
  let list;
  let total;
  if (kind === 'playlists') {
    const { data } = await api(s, '/Items', { ...base, IncludeItemTypes: 'Playlist', SortBy: 'SortName', Fields: 'ChildCount,Overview' });
    list = arr(data.Items).map((p) => playlistItem(s, sess, p));
    total = num(data.TotalRecordCount);
  } else {
    const found = ALBUM_KINDS.find(([id]) => id === kind);
    if (!found) throw new Error(tr('无效的专辑分类', 'Invalid album category'));
    const { data } = await api(s, '/Items', {
      ...base,
      IncludeItemTypes: 'MusicAlbum',
      SortBy: found[2],
      SortOrder: found[3],
      Filters: found[4],
      Fields: 'ChildCount,ProductionYear,AlbumArtists',
    });
    list = arr(data.Items).map((a) => albumItem(s, sess, a));
    total = num(data.TotalRecordCount);
  }
  return { list, page, total, has_more: page * PAGE < total, source: SOURCE };
}

const CHARTS = [
  ['random', tr('随机歌曲', 'Random songs'), { SortBy: 'Random' }],
  ['starred', tr('收藏歌曲', 'Favorite songs'), { Filters: 'IsFavorite', SortBy: 'SortName' }],
  ['recent', tr('最近播放', 'Recently played'), { Filters: 'IsPlayed', SortBy: 'DatePlayed', SortOrder: 'Descending' }],
  ['frequent', tr('常听歌曲', 'Most played songs'), { Filters: 'IsPlayed', SortBy: 'PlayCount', SortOrder: 'Descending' }],
];

async function discoveryCharts() {
  return CHARTS.map(([id, name]) => ({ id, name, img: '', source: SOURCE, update_frequency: '' }));
}

async function chartDetail(_source, { id, page }) {
  const chart = CHARTS.find(([cid]) => cid === id);
  if (!chart) throw new Error(tr('无效榜单参数', 'Invalid chart parameter'));
  const s = await settingsReady();
  // A random list has no stable pages: serve one batch.
  const result = await trackPage(s, chart[2], id === 'random' ? 1 : page, PAGE);
  if (id === 'random') result.allPage = 1;
  return { ...result, info: { name: chart[1], img: '', desc: '', author: '' } };
}

async function testConnection() {
  const s = settings();
  // Always sign in again: a saved session is not evidence of a current connection.
  cerumusic.storage.remove('session');
  const sess = await login(s);
  const r = await cerumusic.request(`${s.base}/Users/${sess.userId}`, { headers: { ...identity(s, sess.token), Accept: 'application/json' } });
  parse(r, 'user');
  return { success: true };
}

async function getPlaylists(_source, { page, limit }) {
  const s = await settingsReady();
  const sess = await session(s);
  const { data } = await api(s, '/Items', {
    UserId: sess.userId, IncludeItemTypes: 'Playlist', Recursive: true, SortBy: 'SortName',
    StartIndex: (page - 1) * limit, Limit: limit, Fields: 'ChildCount,Overview', EnableTotalRecordCount: true,
  });
  const total = num(data.TotalRecordCount);
  return { list: arr(data.Items).map((p) => playlistItem(s, sess, p)), allPage: pages(total, limit), limit, total, source: SOURCE };
}

// ─── singer ────────────────────────────────────────────────
async function count(s, sess, type, artistId) {
  const { data } = await api(s, '/Items', {
    UserId: sess.userId, IncludeItemTypes: type, Recursive: true, ArtistIds: artistId, Limit: 0, EnableTotalRecordCount: true,
  });
  return num(data.TotalRecordCount);
}

async function singerInfo(_source, { id }) {
  const s = await settingsReady();
  const sess = await session(s);
  id = String(id);
  const a = (await api(s, `/Users/${sess.userId}/Items/${enc(id)}`, {})).data || {};
  return {
    id,
    source: SOURCE,
    name: str(a, 'Name'),
    desc: str(a, 'Overview').replace(/<[^>]*>/g, '').trim(),
    avatar: image(s, sess, a, 300),
    gender: null,
    musicCount: await count(s, sess, 'Audio', id),
    albumCount: await count(s, sess, 'MusicAlbum', id),
  };
}

async function singerSongs(_source, { id, page, limit }) {
  return trackPage(await settingsReady(), { ArtistIds: String(id), SortBy: 'Album,ParentIndexNumber,IndexNumber,SortName' }, page, limit);
}

async function singerAlbums(_source, { id, page, limit }) {
  const s = await settingsReady();
  const sess = await session(s);
  const { data } = await api(s, '/Items', {
    UserId: sess.userId, IncludeItemTypes: 'MusicAlbum', Recursive: true, ArtistIds: String(id), SortBy: 'ProductionYear,SortName',
    SortOrder: 'Descending', StartIndex: (page - 1) * limit, Limit: limit, Fields: 'ChildCount,ProductionYear,AlbumArtists', EnableTotalRecordCount: true,
  });
  const total = num(data.TotalRecordCount);
  const list = arr(data.Items).map((a) => ({
    id: `al-${a.Id}`,
    count: num(a.ChildCount),
    name: str(a, 'Name'),
    author: str(a, 'AlbumArtist'),
    img: image(s, sess, a, 300),
    desc: null,
  }));
  return { list, allPage: pages(total, limit), limit, total, source: SOURCE };
}

// ─── lyrics (Jellyfin 10.9+) ───────────────────────────────
const lrcTime = (ticks) => {
  const t = Math.max(0, Math.trunc(ticks / 10000));
  const m = Math.floor(t / 60000);
  const sec = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  return `[${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`;
};

async function lyrics(_source, { song: item }) {
  const s = await settingsReady();
  const id = String((item && item.songmid) || '');
  if (!id || id.length > 128) throw new Error(tr('无效歌曲 ID', 'Invalid song ID'));
  const { data } = await api(s, `/Audio/${enc(id)}/Lyrics`, {});
  const lines = arr(data && data.Lyrics);
  const synced = lines.some((l) => Number.isFinite(l.Start));
  const lyric = lines.map((l) => (synced && Number.isFinite(l.Start) ? lrcTime(l.Start) : '') + str(l, 'Text')).join('\n');
  if (!lyric.trim()) throw new Error(tr('没有找到歌词', 'No lyrics found'));
  return { lyric, tlyric: '', rlyric: '', crlyric: '', source: SOURCE };
}

// ─── playback / download ───────────────────────────────────
const BITRATE = { '128k': 128000, '320k': 320000 };

async function streamUrl(item, quality, download) {
  const s = await settingsReady();
  const sess = await session(s);
  const id = item && item.songmid;
  if (id === undefined || id === null || id === '') throw new Error(tr('缺少歌曲 ID', 'Missing song ID'));
  if (BITRATE[quality]) {
    // Lower qualities are transcoded to MP3, which every player decodes.
    return media(s, sess, `/Audio/${enc(id)}/universal`, {
      UserId: sess.userId,
      DeviceId: deviceId(),
      MaxStreamingBitrate: BITRATE[quality],
      Container: 'mp3',
      AudioCodec: 'mp3',
      TranscodingContainer: 'mp3',
      TranscodingProtocol: 'http',
    });
  }
  return download
    ? media(s, sess, `/Items/${enc(id)}/Download`, {})
    : media(s, sess, `/Audio/${enc(id)}/stream`, { static: true });
}

const musicUrl = (_source, { song: item, quality }) => streamUrl(item, quality, false);
const downloadUrl = (_source, { song: item, quality }) => streamUrl(item, quality, true);

async function cover(_source, { song: item }) {
  if (item && typeof item.img === 'string' && item.img) return item.img;
  const id = String((item && item.songmid) || '');
  if (!id || id.length > 128) throw new Error(tr('无效歌曲 ID', 'Invalid song ID'));
  const s = await settingsReady();
  const sess = await session(s);
  const it = (await api(s, `/Users/${sess.userId}/Items/${enc(id)}`, {})).data || {};
  return image(s, sess, it, 300);
}

const CAPABILITIES = ['search', 'searchPlaylist', 'playlistDetail', 'albumDetail', 'discovery', 'singer', 'play', 'download', 'testConnection', 'userPlaylists', 'cover'];
if (!EMBY) CAPABILITIES.push('lyrics');

module.exports = {
  listPlugin: {
    cover,
    lyrics,
    name: `${LABEL}（列表）`,
    displayName: tr(`${LABEL}（列表）`, `${LABEL} (List)`),
    version: '1.1.0',
    author: 'Mio Music',
    description: tr(
      `${LABEL} 媒体服务器的音乐库：搜索、专辑与歌单、随机/收藏/常听歌曲、歌手${EMBY ? '' : '、歌词'}，并由本插件提供播放与下载。`,
      `${LABEL} media server music library: search, albums and playlists, random/favorite/most played songs, artists${EMBY ? '' : ', lyrics'}, with playback and download provided by this plugin.`,
    ),
    config: [
      { key: 'baseUrl', label: tr('服务器地址', 'Server address'), type: 'text', required: true, placeholder: EMBY ? 'http://192.168.1.2:8096' : 'https://jellyfin.example.com', description: EMBY ? tr('服务器根地址，不含 /emby', 'Server root, without /emby') : tr('服务器根地址', 'Server root') },
      { key: 'username', label: tr('用户名', 'Username'), type: 'text', description: tr('使用访问密钥时可留空（留空取第一个用户）', 'May be left empty when using an API key (the first user is used)') },
      { key: 'password', label: tr('密码', 'Password'), type: 'password', description: tr('用于登录；账号没有密码时可留空', 'Used to sign in; may be left empty if the account has no password') },
      { key: 'apiKey', label: tr('访问密钥（可选）', 'API key (optional)'), type: 'password', description: tr('控制台 → API 密钥；填写后不再使用密码登录', 'Dashboard → API Keys; when set, the password is no longer used to sign in') },
      { key: 'clientName', label: tr('客户端名称', 'Client name'), type: 'text', default: 'Mio' },
      { key: 'allowHttp', label: tr('允许 HTTP（不加密）', 'Allow HTTP (unencrypted)'), type: 'switch', default: false, description: tr('回环地址（localhost）无需勾选', 'Not needed for loopback addresses (localhost)') },
    ],
    defaults: { play: true, download: true },
    sources: {
      [SOURCE]: {
        name: LABEL,
        icon: '🎵',
        capabilities: CAPABILITIES,
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
