# 安全策略

[English](SECURITY.md) · **简体中文**

## 受支持的版本

只有每个脚本的最新版本（随最新的 [Mio-Music](https://github.com/Mio888888/Mio-Music) 发布内置的那一版）会收到安全修复。

## 报告漏洞

**请不要为安全问题新建公开的 issue。** 请私下报告：

1. 打开[安全页](https://github.com/Mio888888/mio-music-plugins/security)，选择 **Report a vulnerability**（[直达链接](https://github.com/Mio888888/mio-music-plugins/security/advisories/new)）。
2. 如果没有这个入口，请新建一个标题为 “Security contact”、**不含任何细节**的 issue，请求私下沟通的渠道。

请写明插件及其版本、服务器类型与版本、复现步骤，以及攻击者能做到什么。请不要附上真实的密码、令牌、访问密钥、私有服务器地址或他人的数据。

这是一个志愿者项目。我们会尽快确认收到报告，通常在一周内，处理期间会向你同步进展，你愿意的话会在发布说明里致谢。请给我们合理的时间发布修复，再公开披露问题。

## 属于范围内的问题

- 密码、令牌或访问密钥被发送到用户所配置服务器之外的主机、写入日志，或出现在错误信息里。
- 用户没有开启“允许 HTTP（不加密）”却接受了明文 `http://` 地址，或脚本削弱了 TLS 校验。
- 服务器的响应可以把请求重定向到其他主机，或脚本用服务器数据拼 URL 的方式让服务器能够操纵请求。
- 来自服务器的文本或标记被脚本变成不安全的内容，例如未转义的值被放进 URL 或请求。
- 因脚本自身的缺陷而超出宿主沙箱授予它的范围。

## 不属于范围的问题

- 逃出插件沙箱本身。请报告到 [Mio-Music](https://github.com/Mio888888/Mio-Music/security/advisories/new)。
- Songloft、Subsonic、Navidrome、Jellyfin、Emby、Plex 自身的漏洞。请报告给对应的项目。
- 用户自己服务器里内容的合法性。
- 插件配置（包括密码）由应用保存在设备上，插件本身不加密。这是已知的设计限制，请用操作系统的磁盘加密保护设备。
- 播放、下载和封面地址会带上服务器协议要求的凭据（例如 Subsonic 的加盐令牌、Plex 的 `X-Plex-Token`、Jellyfin 与 Emby 的访问密钥）。请妥善保管这类地址，并为你的服务器使用 HTTPS。
