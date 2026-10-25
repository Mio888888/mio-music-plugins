# mio-music-plugins

[English](README.md) | **简体中文**

[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

[Mio-Music](https://github.com/Mio888888/Mio-Music) 的音乐列表插件：Songloft、Subsonic、Navidrome、Jellyfin、Emby、Plex 的接入脚本。每个 `*.list.js` 是自包含脚本，在宿主的 QuickJS 沙箱中运行，登录你自己的服务器，并提供声明支持的能力，让自建音乐库成为带播放与下载的音乐来源。

## 插件

| 文件 | 来源 ID | 版本 | 能力 |
|---|---|---|---|
| `songloft.list.js` | `songloft` | 1.1.0 | 搜索、专辑/歌手/流派与歌单、发现、歌词、播放与下载 |
| `subsonic.list.js` | `subsonic` | 1.3.0 | 搜索、专辑与歌单、发现、播放与下载。适用于任何兼容 Subsonic 的服务器；无歌手页与歌词（Navidrome 请用 `navidrome`） |
| `navidrome.list.js` | `navidrome` | 1.1.0 | 搜索、专辑与歌单、发现、歌手、歌词、播放与下载 |
| `jellyfin.list.js` | `jellyfin` | 1.1.0 | 搜索、专辑与歌单、发现、歌手、歌词、播放与下载 |
| `emby.list.js` | `emby` | 1.1.0 | 搜索、专辑与歌单、发现、歌手、播放与下载（无歌词） |
| `plex.list.js` | `plex` | 1.1.0 | 搜索、专辑与歌单、发现、歌手、播放与下载（无歌词） |

所有插件提供相同的音质选项（`128k`、`320k`、`flac`），配置表单里都有“测试连接”。

## 语言

插件文本为中英双语，并跟随 Mio-Music 的语言：描述、配置表单标签、发现分类、榜单名称和错误提示都会在应用内切换语言时随之切换，已安装的插件会自动刷新且保留配置。宿主通过 `cerumusic.locale`（`zh-CN` 或 `en-US`）告诉脚本当前语言；宿主没有提供时使用中文。

插件的 `name` 保持中文（如 `Navidrome（列表）`），因为宿主靠它识别已安装的插件；界面显示的标题来自可选的 `displayName`，它是双语的。

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

脚本导出 `module.exports = { listPlugin: { name, displayName, version, author, description, config, sources, ...方法 } }`，方法返回与宿主 `mio-music-sdk` 类型一致的 camelCase JSON。宿主提供 `cerumusic.request`、`cerumusic.requestAll`、`cerumusic.storage`、`cerumusic.config`、`cerumusic.utils.crypto.md5` 等；`cerumusic.locale` 是界面语言（`zh-CN` 或 `en-US`）；没有文件系统、进程和 `require`。限制：单次调用 30 秒、最多 24 个请求、响应体 ≤16MB、脚本 ≤1MiB。

面向用户的文本都走 `tr(中文, 英文)`，它在每个脚本开头根据 `cerumusic.locale` 定义。新增的文本（包括抛出的错误信息）都要用它包起来，`name` 与头部 `@name` 保持不变。

## 验证状态

Navidrome 与 Jellyfin 已对官方公开演示服务器实际调用；Songloft、Plex、Emby 仅按其文档用本地模拟服务跑通流程，未对真实服务器验证；Subsonic 没有对真实服务器的验证记录；Jellyfin 的下载地址因演示账号无权限未验证。双语文本已在宿主运行时中以两种语言加载全部六个脚本做过检查（元数据、配置表单标签、发现分类、缺少配置时的报错），也验证了已安装插件切换语言；需要真实服务器才会走到的英文错误提示和榜单名称没有运行过。本仓库没有自动化测试。

## 贡献、安全与许可

欢迎参与贡献：见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) 与[行为准则](CODE_OF_CONDUCT.zh-CN.md)。安全问题请按 [SECURITY.zh-CN.md](SECURITY.zh-CN.md) 私下报告。

采用 [GNU Affero General Public License v3.0 only](LICENSE)（`AGPL-3.0-only`）许可，与内嵌这些脚本的 Mio-Music 一致。这些插件所连接的服务器产品（Songloft、Subsonic、Navidrome、Jellyfin、Emby、Plex）是各自独立的项目，有各自的许可证与商标；本仓库与它们没有隶属关系。
