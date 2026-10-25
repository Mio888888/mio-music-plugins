# Contributing to mio-music-plugins

**English** · [简体中文](CONTRIBUTING.zh-CN.md)

Thanks for helping. Bug reports, fixes, documentation and support for more servers are all welcome. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first, and report security problems privately as described in [SECURITY.md](SECURITY.md).

## Before you start

- **Bugs and ideas:** search the [issues](https://github.com/Mio888888/mio-music-plugins/issues) first, then open one with the template. For a new server type or a large change, open an issue before you write code so the approach can be agreed.
- **Self-hosted servers only.** These plugins connect to a server that the user runs and signs in to. Do not add code, assets, API keys or endpoints that bundle or hard-code access to a copyrighted music service.
- **Licensing.** The repository is licensed under [AGPL-3.0-only](LICENSE), the same as [Mio-Music](https://github.com/Mio888888/Mio-Music), which embeds these scripts. By submitting a contribution you agree to license it under the same terms, and you confirm you have the right to do so. Do not copy in code whose license is not compatible with AGPL-3.0.

## How the scripts are used

- Each `*.list.js` is self-contained and runs in the host's QuickJS sandbox: no file system, no process, no `require`, at most 24 requests and 30 seconds per call. The contract is described in the [README](README.md#contract).
- Mio-Music mounts this repository as the `plugins/` submodule and embeds the scripts in the repository root with `include_str!`. **Keep the scripts in the root and do not rename them.**
- The host identifies an installed plugin by its `name` (the header `@name` and the exported `name`) and updates the installed copy when `@version` is higher. **Never change the `name`**, and **bump the version** (the header `@version` and the exported `version`) with every behavior change.
- `emby.list.js` and `jellyfin.list.js` share one code base and differ only in the header and the `FLAVOR` line. Apply a change to both.

## Text must be bilingual

All text the user can see is Chinese and English, picked by the host's language (`cerumusic.locale`) through `tr(zh, en)` at the top of each script. Wrap every new string, including thrown error messages, descriptions, form labels and discovery names. Keep the two versions equivalent, and keep identifiers, URLs and placeholders such as `http://192.168.1.2:8096` untranslated.

## Making a change

1. Fork the repository and branch from `main`.
2. Keep the change focused: one server or one concern per pull request.
3. Check the script loads in the host. There is no test suite here, so run it in [Mio-Music](https://github.com/Mio888888/Mio-Music) (or its `cargo test -p mio-plugin` runtime) against a real server or a mock built from the server's documentation, in both languages.
4. Say in the pull request which server and version you ran against, and what you tried (search, playlists, playback, download, lyrics).
5. Update the [README](README.md) and [README.zh-CN.md](README.zh-CN.md) when capabilities, configuration or behavior change.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, and so on, with an optional scope such as `fix(plex):`. Write the subject for a user.

## Pull requests

Open the pull request against `main` and fill in the template. Small, reviewable pull requests are merged faster than large ones. A maintainer may ask for changes; please keep the conversation on the pull request. Never include passwords, tokens, access keys or private server addresses in a pull request, issue or log.
