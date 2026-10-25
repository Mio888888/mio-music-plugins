/**
 * @name Navidrome（列表）
 * @version 1.1.0
 * @author Mio Music
 * @description Navidrome 音乐服务器：搜索、专辑与歌单、随机/收藏歌曲、歌手、歌词，并由本插件提供播放与下载地址。
 *
 * Music-list plugin for the Mio Music GPUI host (source ID `navidrome`), over Navidrome's Subsonic / OpenSubsonic API. The server address and
 * account are set in the plugin's configuration form; the verified login is cached in the
 * plugin's own store so each call does not have to ping the server first.
 */

/**
 * Text follows the host's language: `cerumusic.locale` is `zh-CN` or `en-US`, and Chinese is the
 * fallback for a host that does not provide it. `tr(zh, en)` picks one. The plugin `name` stays
 * Chinese on purpose: the host identifies an installed plugin by it.
 */
const EN = typeof cerumusic.locale === 'string' && !/^zh/i.test(cerumusic.locale);
const tr = (zh, en) => (EN ? en : zh);
const SOURCE = 'navidrome';
const PAGE = 30;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ALBUM_KINDS = [
  ['newest', tr('最新添加', 'Recently added')],
  ['recent', tr('最近播放', 'Recently played')],
  ['frequent', tr('常听专辑', 'Most played')],
  ['random', tr('随机专辑', 'Random albums')],
  ['starred', tr('我的收藏', 'My favorites')],
  ['alphabeticalByName', tr('按名称', 'By name')],
];

const str = (o, k) => (o !== null && typeof o === 'object' && typeof o[k] === 'string' ? o[k] : '');
const num = (v) => (Number.isFinite(v) ? v : 0);
const arr = (v) => (Array.isArray(v) ? v : []);
const playTime = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
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
  if (path.endsWith('/rest')) path = path.slice(0, -5);
  return {
    base: `${m[1].toLowerCase()}://${m[2]}${path}`,
    username,
    password,
    apiVersion: String(c.apiVersion || '').trim() || '1.16.1',
    clientName: String(c.clientName || '').trim() || 'Mio',
  };
}

/** Token authentication: a fresh salt per URL, the password itself is never sent. */
function auth(s) {
  let salt = '';
  for (let i = 0; i < 16; i += 1) salt += Math.floor(Math.random() * 16).toString(16);
  const token = cerumusic.utils.crypto.md5(s.password + salt);
  return `u=${enc(s.username)}&v=${enc(s.apiVersion)}&c=${enc(s.clientName)}&f=json&s=${salt}&t=${token}`;
}

function url(s, method, params) {
  const extra = Object.entries(params || {})
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
  return `${s.base}/rest/${method}.view?${auth(s)}${extra ? '&' + extra : ''}`;
}

const sessionKey = (s) => `${s.base}|${s.username}|${cerumusic.utils.crypto.md5(s.password)}`;

async function call(s, method, params) {
  const r = await cerumusic.request(url(s, method, params), {});
  if (r.statusCode < 200 || r.statusCode >= 300) throw new Error(tr(`Navidrome 返回 HTTP ${r.statusCode}`, `Navidrome returned HTTP ${r.statusCode}`));
  let body = r.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (_) {
      throw new Error(tr('Navidrome 返回的不是 JSON（地址是否指向了网页？）', 'Navidrome did not return JSON (does the address point to a web page?)'));
    }
  }
  const data = body && body['subsonic-response'];
  if (!data) throw new Error(tr('Navidrome 返回了无效数据', 'Navidrome returned invalid data'));
  if (data.status === 'ok') return data;
  const code = data.error && data.error.code;
  if (code === 40) {
    cerumusic.storage.remove('session');
    throw new Error(tr('Navidrome 登录失败：用户名或密码错误', 'Navidrome login failed: wrong username or password'));
  }
  throw new Error(tr(`Navidrome 接口错误 ${code === undefined ? '' : code}`, `Navidrome API error ${code === undefined ? '' : code}`).trim());
}

/** Verifies the login once and remembers it, so later calls skip the ping. */
async function ready() {
  const s = settings();
  const cached = cerumusic.storage.get('session');
  if (cached && cached.key === sessionKey(s) && Date.now() - cached.verifiedAt < SESSION_TTL_MS) return s;
  const data = await call(s, 'ping', {});
  cerumusic.storage.set('session', {
    key: sessionKey(s),
    verifiedAt: Date.now(),
    apiVersion: str(data, 'version'),
    server: str(data, 'type') ? `${str(data, 'type')} ${str(data, 'serverVersion')}`.trim() : '',
  });
  return s;
}

// ─── mapping ───────────────────────────────────────────────
const coverUrl = (s, id, size) => (id ? url(s, 'getCoverArt', { id, size }) : '');

function song(s, v) {
  const suffix = str(v, 'suffix').toLowerCase();
  const lossless = ['flac', 'alac', 'wav', 'aiff'].includes(suffix);
  const types = lossless ? ['flac', '320k', '128k'] : num(v.bitRate) >= 320 ? ['320k', '128k'] : ['128k'];
  return {
    songmid: String(v.id),
    singer: str(v, 'artist'),
    name: str(v, 'title'),
    albumName: str(v, 'album'),
    albumId: v.albumId === undefined ? '' : String(v.albumId),
    singerId: v.artistId === undefined || v.artistId === null ? undefined : String(v.artistId),
    source: SOURCE,
    interval: playTime(Math.trunc(num(v.duration))),
    img: coverUrl(s, str(v, 'coverArt'), 300),
    types,
    typeUrl: {},
  };
}

const songs = (s, list) =>
  arr(list)
    .filter((v) => v && v.id !== undefined && v.id !== null && v.id !== '')
    .map((v) => song(s, v));

// ─── list API ──────────────────────────────────────────────
async function search(_source, { keyword, page, limit }) {
  const s = await ready();
  const offset = (page - 1) * limit;
  const data = await call(s, 'search3', {
    query: keyword.trim(), songCount: limit, songOffset: offset, artistCount: 0, albumCount: 0,
  });
  const list = songs(s, data.searchResult3 && data.searchResult3.song);
  // The library search has offsets, not a total: another page exists while pages are full.
  const total = offset + list.length;
  return { list, allPage: page + (list.length >= limit ? 1 : 0), limit, total, source: SOURCE };
}

/** `al-<id>` is an album, `pl-<id>` a server playlist; a bare ID is taken as an album. */
async function playlistDetail(_source, { id, page, limit }) {
  const s = await ready();
  id = String(id);
  let rows;
  let info;
  if (id.startsWith('pl-')) {
    const data = await call(s, 'getPlaylist', { id: id.slice(3) });
    const p = data.playlist || {};
    rows = arr(p.entry);
    info = { name: str(p, 'name'), img: coverUrl(s, str(p, 'coverArt'), 480), desc: str(p, 'comment'), author: str(p, 'owner') };
  } else {
    const data = await call(s, 'getAlbum', { id: id.startsWith('al-') ? id.slice(3) : id });
    const a = data.album || {};
    rows = arr(a.song);
    info = { name: str(a, 'name'), img: coverUrl(s, str(a, 'coverArt'), 480), desc: '', author: str(a, 'artist') };
  }
  const total = rows.length;
  const start = Math.min(limit * (page - 1), total);
  return {
    list: songs(s, rows.slice(start, start + limit)),
    info,
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
  const s = await ready();
  const kind = category === '' ? 'newest' : category;
  let list;
  let hasMore;
  if (kind === 'playlists') {
    const data = await call(s, 'getPlaylists', {});
    const all = arr(data.playlists && data.playlists.playlist);
    list = all.slice((page - 1) * PAGE, page * PAGE).map((p) => ({
      id: `pl-${p.id}`,
      name: str(p, 'name'),
      img: coverUrl(s, str(p, 'coverArt'), 300),
      source: SOURCE,
      desc: str(p, 'comment'),
      playCount: null,
      author: str(p, 'owner'),
      total: num(p.songCount),
    }));
    hasMore = page * PAGE < all.length;
  } else {
    if (!ALBUM_KINDS.some(([id]) => id === kind)) throw new Error(tr('无效的专辑分类', 'Invalid album category'));
    const data = await call(s, 'getAlbumList2', { type: kind, size: PAGE, offset: (page - 1) * PAGE });
    list = arr(data.albumList2 && data.albumList2.album).map((a) => ({
      id: `al-${a.id}`,
      name: str(a, 'name'),
      img: coverUrl(s, str(a, 'coverArt'), 300),
      source: SOURCE,
      desc: '',
      playCount: null,
      author: str(a, 'artist'),
      total: num(a.songCount),
    }));
    hasMore = list.length >= PAGE;
  }
  return { list, page, total: null, has_more: hasMore, source: SOURCE };
}

async function testConnection() {
  // Always ping: a saved login cache is not evidence of a current connection.
  await call(settings(), 'ping', {});
  return { success: true };
}

async function getPlaylists(_source, { page, limit }) {
  const s = await ready();
  const data = await call(s, 'getPlaylists', {});
  const all = arr(data.playlists && data.playlists.playlist);
  const list = all.slice((page - 1) * limit, page * limit).map((p) => ({
    id: `pl-${p.id}`, name: str(p, 'name'),
    img: coverUrl(s, str(p, 'coverArt'), 300), source: SOURCE,
    desc: str(p, 'comment'), author: str(p, 'owner'), total: num(p.songCount),
  }));
  return { list, allPage: pages(all.length, limit), limit, total: all.length, source: SOURCE };
}

/** Navidrome has no charts; two song lists stand in for them. */
async function discoveryCharts() {
  return [
    { id: 'random', name: tr('随机歌曲', 'Random songs'), img: '', source: SOURCE, update_frequency: '' },
    { id: 'starred', name: tr('收藏歌曲', 'Favorite songs'), img: '', source: SOURCE, update_frequency: '' },
  ];
}

async function chartDetail(_source, { id, page }) {
  const s = await ready();
  let rows;
  if (id === 'random') {
    const data = await call(s, 'getRandomSongs', { size: PAGE });
    rows = arr(data.randomSongs && data.randomSongs.song);
  } else if (id === 'starred') {
    const data = await call(s, 'getStarred2', {});
    rows = arr(data.starred2 && data.starred2.song);
  } else {
    throw new Error(tr('无效榜单参数', 'Invalid chart parameter'));
  }
  const total = rows.length;
  return {
    list: songs(s, rows.slice((page - 1) * PAGE, page * PAGE)),
    info: { name: id === 'random' ? tr('随机歌曲', 'Random songs') : tr('收藏歌曲', 'Favorite songs'), img: '', desc: '', author: '' },
    allPage: pages(total, PAGE),
    limit: PAGE,
    total,
    source: SOURCE,
  };
}

// ─── playback / download ───────────────────────────────────
const BITRATE = { '128k': 128, '320k': 320 };

async function musicUrl(_source, { song: item, quality }) {
  const s = await ready();
  const id = item && item.songmid;
  if (id === undefined || id === null || id === '') throw new Error(tr('缺少歌曲 ID', 'Missing song ID'));
  const params = { id: String(id) };
  // The original file for lossless. The lower qualities are transcoded down to MP3 explicitly:
  // without a format the server picks its default transcoding (often Opus), which the player
  // cannot decode.
  if (BITRATE[quality]) {
    params.maxBitRate = BITRATE[quality];
    params.format = 'mp3';
  }
  return url(s, 'stream', params);
}

async function downloadUrl(_source, { song: item, quality }) {
  const s = await ready();
  const id = item && item.songmid;
  if (id === undefined || id === null || id === '') throw new Error(tr('缺少歌曲 ID', 'Missing song ID'));
  if (BITRATE[quality]) return url(s, 'stream', { id: String(id), maxBitRate: BITRATE[quality], format: 'mp3' });
  return url(s, 'download', { id: String(id) });
}



async function cover(_source, {song}) {
  if(song&&typeof song.img==='string'&&song.img)return song.img;
  song=song||{};
  const id=String(song.songmid||'');
  if(!id||id.length>128)throw Error(tr('无效歌曲 ID', 'Invalid song ID'));
  const s=await ready();
  const data=await call(s,'getSong',{id});
  return coverUrl(s,str(data.song,'coverArt'),300);
}



// ─── lyrics (OpenSubsonic) ─────────────────────────────────
const lrcTime = (ms) => {
  const t = Math.max(0, Math.trunc(ms));
  const m = Math.floor(t / 60000);
  const sec = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  return `[${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`;
};

/** A structured lyrics entry as LRC text; unsynced lines carry no time tags. */
function lrcOf(entry) {
  const lines = arr(entry && entry.line);
  const off = num(entry && entry.offset);
  return lines
    .map((l) => (entry.synced ? lrcTime(num(l.start) + off) : '') + str(l, 'value'))
    .join('\n');
}

async function lyrics(_source, { song: item }) {
  const s = await ready();
  const id = String((item && item.songmid) || '');
  if (!id || id.length > 128) throw new Error(tr('无效歌曲 ID', 'Invalid song ID'));
  let lyric = '';
  try {
    const data = await call(s, 'getLyricsBySongId', { id });
    const list = arr(data.lyricsList && data.lyricsList.structuredLyrics);
    const pick = list.find((e) => e.synced) || list[0];
    if (pick) lyric = lrcOf(pick);
  } catch (_) {
    // Older servers have no OpenSubsonic extension; fall through to the classic call.
  }
  if (!lyric && item && item.name) {
    const data = await call(s, 'getLyrics', { artist: item.singer || '', title: item.name });
    lyric = str(data.lyrics, 'value');
  }
  if (!lyric.trim()) throw new Error(tr('没有找到歌词', 'No lyrics found'));
  return { lyric, tlyric: '', rlyric: '', crlyric: '', source: SOURCE };
}

// ─── singer ────────────────────────────────────────────────
const SINGER_ALBUMS_PER_PAGE = 10;

async function singerInfo(_source, { id }) {
  const s = await ready();
  id = String(id);
  const data = await call(s, 'getArtist', { id });
  const a = data.artist || {};
  let desc = '';
  try {
    const info = (await call(s, 'getArtistInfo2', { id })).artistInfo2 || {};
    desc = str(info, 'biography').replace(/<[^>]*>/g, '').trim();
  } catch (_) {}
  const albums = arr(a.album);
  return {
    id,
    source: SOURCE,
    name: str(a, 'name'),
    desc,
    avatar: coverUrl(s, str(a, 'coverArt'), 300),
    gender: null,
    musicCount: albums.reduce((n, al) => n + num(al.songCount), 0),
    albumCount: num(a.albumCount) || albums.length,
  };
}

async function singerAlbums(_source, { id, page, limit }) {
  const s = await ready();
  const all = arr(((await call(s, 'getArtist', { id: String(id) })).artist || {}).album);
  const list = all.slice((page - 1) * limit, page * limit).map((al) => ({
    id: `al-${al.id}`,
    count: num(al.songCount),
    name: str(al, 'name'),
    author: str(al, 'artist'),
    img: coverUrl(s, str(al, 'coverArt'), 300),
    desc: null,
  }));
  return { list, allPage: pages(all.length, limit), limit, total: all.length, source: SOURCE };
}

/** An artist's songs are its albums' songs: one page covers a few albums. */
async function singerSongs(_source, { id, page }) {
  const s = await ready();
  const albums = arr(((await call(s, 'getArtist', { id: String(id) })).artist || {}).album);
  const slice = albums.slice((page - 1) * SINGER_ALBUMS_PER_PAGE, page * SINGER_ALBUMS_PER_PAGE);
  const replies = await cerumusic.requestAll(slice.map((al) => ({ url: url(s, 'getAlbum', { id: al.id }), options: {} })));
  const list = [];
  for (const reply of replies) {
    if (!reply.response || reply.response.statusCode !== 200) continue;
    let body = reply.response.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { continue; }
    }
    const data = body && body['subsonic-response'];
    if (data && data.status === 'ok') list.push(...songs(s, data.album && data.album.song));
  }
  const total = albums.reduce((n, al) => n + num(al.songCount), 0);
  return { list, allPage: pages(albums.length, SINGER_ALBUMS_PER_PAGE), limit: list.length, total, source: SOURCE };
}

module.exports = {
  listPlugin: {
    cover,
    lyrics,
    singerInfo,
    singerSongs,
    singerAlbums,
    name: 'Navidrome（列表）',
    displayName: tr('Navidrome（列表）', 'Navidrome (List)'),
    version: '1.1.0',
    author: 'Mio Music',
    description: tr(
      'Navidrome 音乐服务器：搜索、专辑与歌单、随机/收藏歌曲、歌手、歌词，并由本插件提供播放与下载。',
      'Navidrome music server: search, albums and playlists, random/favorite songs, artists and lyrics, with playback and download provided by this plugin.',
    ),
    config: [
      { key: 'baseUrl', label: tr('服务器地址', 'Server address'), type: 'text', required: true, placeholder: 'https://music.example.com', description: tr('服务器根地址，不含 /rest', 'Server root, without /rest') },
      { key: 'username', label: tr('用户名', 'Username'), type: 'text', required: true },
      { key: 'password', label: tr('密码', 'Password'), type: 'password', required: true, description: tr('仅以令牌形式发送，不会明文出现在请求里', 'Sent only as a salted token, never in clear text') },
      { key: 'apiVersion', label: tr('API 版本', 'API version'), type: 'text', default: '1.16.1' },
      { key: 'clientName', label: tr('客户端名称', 'Client name'), type: 'text', default: 'Mio' },
      { key: 'allowHttp', label: tr('允许 HTTP（不加密）', 'Allow HTTP (unencrypted)'), type: 'switch', default: false, description: tr('回环地址（localhost）无需勾选', 'Not needed for loopback addresses (localhost)') },
    ],
    defaults: { play: true, download: true },
    sources: {
      navidrome: {
        name: 'Navidrome', icon: '🎵',
        capabilities: ['search', 'playlistDetail', 'albumDetail', 'discovery', 'singer', 'lyrics', 'play', 'download', 'testConnection', 'userPlaylists', 'cover'],
        qualities: ['128k', '320k', 'flac'],
      },
    },
    search,
    testConnection,
    getPlaylists,
    playlistDetail,
    albumDetail,
    discoveryCategories,
    discoveryPlaylists,
    discoveryCharts,
    chartDetail,
    musicUrl,
    downloadUrl,
  },
};
