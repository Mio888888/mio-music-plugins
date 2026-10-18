# mio-music-plugins

Mio Music 的音乐列表插件：Songloft、Subsonic、Navidrome、Jellyfin、Emby、Plex 的接入脚本。每个 `*.list.js` 是自包含脚本，在宿主的 QuickJS 沙箱中运行，提供搜索、专辑与歌单、发现、歌手、歌词、播放与下载中声明支持的能力。

| 文件 | 来源 ID | 能力 |
|---|---|---|
| `songloft.list.js` | `songloft` | 搜索、专辑/歌手/流派与歌单、歌词、播放与下载 |
| `subsonic.list.js` | `subsonic` | 搜索、专辑与歌单、发现、播放与下载 |
| `navidrome.list.js` | `navidrome` | 搜索、专辑与歌单、发现、歌手、歌词、播放与下载 |
| `jellyfin.list.js` | `jellyfin` | 搜索、专辑与歌单、发现、歌手、歌词、播放与下载 |
| `emby.list.js` | `emby` | 搜索、专辑与歌单、发现、歌手、播放与下载 |
| `plex.list.js` | `plex` | 搜索、专辑与歌单、发现、歌手、播放与下载 |

## 使用

- 随 [Mio-Music-GPUI](https://github.com/Mio888888/Mio-Music-GPUI) 内置：设置 → 插件 → 音乐列表插件 → “插件目录”，一键安装或更新，安装后在“配置”里填写服务器地址与账号。
- 单独安装：“安装列表插件”，选择本地文件或输入 URL。

更新已安装的插件时重新安装同名脚本即可，配置会保留。

## 作为子模块

本仓库在 Mio-Music-GPUI 中以子模块挂在 `plugins/`，应用用 `include_str!` 把根目录下的脚本嵌入。因此脚本必须放在仓库根目录，文件名不要改；脚本头部 `@name` 与 `@version` 用于目录中的安装状态和更新判断，改动脚本时同步递增版本号。

## 契约

脚本导出 `module.exports = { listPlugin: { name, version, author, description, config, sources, ...方法 } }`，方法返回与宿主 `mio-music-sdk` 类型一致的 camelCase JSON。宿主提供 `cerumusic.request`、`cerumusic.requestAll`、`cerumusic.storage`、`cerumusic.config`、`cerumusic.utils.crypto.md5` 等；没有文件系统、进程和 `require`。限制：单次调用 30 秒、最多 24 个请求、响应体 ≤16MB、脚本 ≤1MiB。

## 验证状态

Navidrome 与 Jellyfin 已对官方公开演示服务器实际调用；Songloft、Plex、Emby 仅按其文档用本地模拟服务跑通流程，未对真实服务器验证；Jellyfin 的下载地址因演示账号无权限未验证。
