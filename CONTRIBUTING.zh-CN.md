# 参与贡献 mio-music-plugins

[English](CONTRIBUTING.md) · **简体中文**

感谢你的参与。无论是问题反馈、修复、文档还是支持更多服务器，我们都欢迎。请先阅读[行为准则](CODE_OF_CONDUCT.zh-CN.md)，安全问题请按 [SECURITY.zh-CN.md](SECURITY.zh-CN.md) 私下报告。

## 开始之前

- **问题与想法：** 先在 [issues](https://github.com/Mio888888/mio-music-plugins/issues) 里搜索，再用模板新建。要支持新的服务器类型或改动较大时，请先开 issue 讨论方案，再动手写代码。
- **只接入自建服务器。** 这些插件连接的是用户自己运行并登录的服务器。请不要加入内置或写死某个受版权保护的音乐服务的代码、资源、密钥或接口地址。
- **许可。** 本仓库采用 [AGPL-3.0-only](LICENSE) 许可，与内嵌这些脚本的 [Mio-Music](https://github.com/Mio888888/Mio-Music) 一致。提交贡献即表示你同意以相同条款授权，并确认你有权这样做。请不要引入许可证与 AGPL-3.0 不兼容的代码。

## 脚本是怎么被使用的

- 每个 `*.list.js` 都是自包含脚本，在宿主的 QuickJS 沙箱中运行：没有文件系统、进程和 `require`，单次调用最多 24 个请求、30 秒。契约见 [README](README.zh-CN.md#契约)。
- Mio-Music 把本仓库作为 `plugins/` 子模块挂载，并用 `include_str!` 嵌入根目录下的脚本。**脚本必须留在根目录，文件名不要改。**
- 宿主靠 `name`（头部 `@name` 与导出的 `name`）识别已安装的插件，并在 `@version` 更高时更新已安装的副本。**不要改 `name`**，每次行为变化都要**递增版本号**（头部 `@version` 与导出的 `version` 两处）。
- `emby.list.js` 与 `jellyfin.list.js` 共用一套代码，只在头部和 `FLAVOR` 一行上不同，改动要同时应用到两个文件。

## 文本必须是双语

用户能看到的所有文本都是中英双语，由宿主的语言（`cerumusic.locale`）通过每个脚本开头的 `tr(中文, 英文)` 选择。新增的字符串都要包起来，包括抛出的错误信息、描述、表单标签和发现分类名。两种语言的含义保持一致；标识符、URL 和 `http://192.168.1.2:8096` 这类占位示例不翻译。

## 提交改动

1. Fork 仓库，从 `main` 建分支。
2. 保持改动聚焦：一个 pull request 只处理一种服务器或一件事。
3. 确认脚本能在宿主里加载。本仓库没有测试套件，请在 [Mio-Music](https://github.com/Mio888888/Mio-Music)（或其 `cargo test -p mio-plugin` 运行时）里，用真实服务器或按服务器文档搭的模拟服务，以两种语言各跑一遍。
4. 在 pull request 里说明你用的服务器及版本，以及试过哪些功能（搜索、歌单、播放、下载、歌词）。
5. 能力、配置或行为有变化时，同步更新 [README.md](README.md) 与 [README.zh-CN.md](README.zh-CN.md)。

## 提交信息

提交遵循 [Conventional Commits](https://www.conventionalcommits.org/)：`feat:`、`fix:`、`docs:` 等，可带范围，如 `fix(plex):`。标题请面向用户来写。

## Pull request

请向 `main` 发起 pull request 并填写模板。小而易审的 pull request 合并得更快。维护者可能会要求修改，请在 pull request 里继续讨论。任何 pull request、issue 或日志里都不要出现密码、令牌、访问密钥或私有服务器地址。
