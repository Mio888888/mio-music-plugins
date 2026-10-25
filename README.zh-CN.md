# mio-music-plugins

[English](README.md) | **简体中文**

[Mio-Music](https://github.com/Mio888888/Mio-Music) 的音乐列表插件：Songloft、Subsonic、Navidrome、Jellyfin、Emby、Plex 的接入脚本。每个 `*.list.js` 是自包含脚本，在宿主的 QuickJS 沙箱中运行，登录你自己的服务器，并提供声明支持的能力，让自建音乐库成为带播放与下载的音乐来源。

## 插件

| 文件 | 来源 ID | 版本 | 能力 |
|---|---|---|---|
| `songloft.list.js` | `songloft` | 1.0.0 | 搜索、专辑/歌手/流派与歌单、发现、歌词、播放与下载 |
| `subsonic.list.js` | `subsonic` | 1.2.1 | 搜索、专辑与歌单、发现、播放与下载。适用于任何兼容 Subsonic 的服务器；无歌手页与歌词（Navidrome 请用 `navidrome`） |
| `navidrome.list.js` | `navidrome` | 1.0.0 | 搜索、专辑与歌单、发现、歌手、歌词、播放与下载 |
| `jellyfin.list.js` | `jellyfin` | 1.0.0 | 搜索、专辑与歌单、发现、歌手、歌词、播放与下载 |
| `emby.list.js` | `emby` | 1.0.0 | 搜索、专辑与歌单、发现、歌手、播放与下载（无歌词） |
| `plex.list.js` | `plex` | 1.0.0 | 搜索、专辑与歌单、发现、歌手、播放与下载（无歌词） |

所有插件提供相同的音质选项（`128k`、`320k`、`flac`），配置表单里都有“测试连接”。

## 使用

- 随 Mio-Music 内置：应用启动时自动安装并按版本更新，在设置 → 插件 → 音乐列表插件的插件卡片上点“配置”，按下表填写后测试连接即可。
- 单独安装：“安装列表插件”，选择本地文件或输入 URL。

更新已安装的插件时重新安装同名脚本即可，配置会保留。

## 配置

每个插件都需要服务器地址与凭据，另有“允许 HTTP（不加密）”开关：未开启时拒绝明文 `http://` 地址，`localhost` 等回环地址除外。

| 插件 | 服务器地址 | 凭据 |
|---|---|---|
| Songloft | 服务器根地址，默认端口 `58091`；经反向代理子路径访问时包含该路径 | 用户名（默认管理员 `admin`）与密码 |
| Subsonic、Navidrome | 服务器根地址，不含 `/rest` | 用户名与密码（仅以加盐令牌发送，不会明文出现在请求里）；可选 API 版本（默认 `1.16.1`）与客户端名称 |
| Jellyfin | 服务器根地址 | 用户名与密码，或访问密钥（控制台 → API 密钥）；使用访问密钥时用户名可留空，取第一个用户 |
| Emby | 服务器根地址，不含 `/emby`（如 `http://192.168.1.2:8096`） | 同 Jellyfin |
| Plex | 服务器根地址，默认端口 `32400` | `X-Plex-Token`（必填），可选音乐库名称，留空则使用第一个音乐库 |

## 行为说明

- **Songloft** 没有自己的专辑和歌手对象：专辑、歌手、流派都是服务器的歌曲分面，打开某一项即列出该值完全匹配的歌曲。
- **Emby 与 Jellyfin** 共用一套代码：两个文件只在头部和开头的 `FLAVOR` 一行上不同（它同时决定是否提供歌词），修复问题时两个文件都要改。
- **Navidrome 与 Subsonic** 都走 Subsonic / OpenSubsonic API；`navidrome.list.js` 在此基础上增加了歌手与歌词。

## 作为子模块

本仓库在 Mio-Music 中以子模块挂在 `plugins/`，应用用 `include_str!` 把根目录下的脚本嵌入。因此脚本必须放在仓库根目录，文件名不要改；脚本头部 `@name` 用来识别内置插件，`@version` 决定启动时是否更新已安装的副本，改动脚本时同步递增版本号（脚本头部与导出的 `version` 两处都要改）。

## 契约

脚本导出 `module.exports = { listPlugin: { name, version, author, description, config, sources, ...方法 } }`，方法返回与宿主 `mio-music-sdk` 类型一致的 camelCase JSON。宿主提供 `cerumusic.request`、`cerumusic.requestAll`、`cerumusic.storage`、`cerumusic.config`、`cerumusic.utils.crypto.md5` 等；没有文件系统、进程和 `require`。限制：单次调用 30 秒、最多 24 个请求、响应体 ≤16MB、脚本 ≤1MiB。

## 验证状态

Navidrome 与 Jellyfin 已对官方公开演示服务器实际调用；Songloft、Plex、Emby 仅按其文档用本地模拟服务跑通流程，未对真实服务器验证；Subsonic 没有对真实服务器的验证记录；Jellyfin 的下载地址因演示账号无权限未验证。本仓库没有自动化测试。
