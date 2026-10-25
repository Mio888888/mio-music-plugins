# mio-music-plugins

**English** | [简体中文](README.zh-CN.md)

[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

Music list plugins for [Mio-Music](https://github.com/Mio888888/Mio-Music): integration scripts for Songloft, Subsonic, Navidrome, Jellyfin, Emby and Plex. Each `*.list.js` is a self-contained script that runs in the host's QuickJS sandbox, signs in to your own server, and provides the capabilities it declares, so your self-hosted library shows up as a music source with playback and download.

## Plugins

| File | Source ID | Version | Capabilities |
|---|---|---|---|
| `songloft.list.js` | `songloft` | 1.1.0 | Search, albums/artists/genres and playlists, discovery, lyrics, playback and download |
| `subsonic.list.js` | `subsonic` | 1.3.0 | Search, albums and playlists, discovery, playback and download. Any Subsonic-compatible server; no artist pages or lyrics (use `navidrome` for Navidrome) |
| `navidrome.list.js` | `navidrome` | 1.1.0 | Search, albums and playlists, discovery, artists, lyrics, playback and download |
| `jellyfin.list.js` | `jellyfin` | 1.1.0 | Search, albums and playlists, discovery, artists, lyrics, playback and download |
| `emby.list.js` | `emby` | 1.1.0 | Search, albums and playlists, discovery, artists, playback and download (no lyrics) |
| `plex.list.js` | `plex` | 1.1.0 | Search, albums and playlists, discovery, artists, playback and download (no lyrics) |

All plugins offer the same quality options (`128k`, `320k`, `flac`), and each has a connection test in its configuration form.

## Language

Plugin text is bilingual (Chinese and English) and follows the language of Mio-Music: descriptions, form labels, discovery categories, chart names and error messages all switch when you change the language in the app, and a plugin that is already installed is refreshed without losing its configuration. The host tells scripts which language is active through `cerumusic.locale` (`zh-CN` or `en-US`). A host that does not provide it gets Chinese.

The plugin `name` stays Chinese (for example `Navidrome（列表）`) because the host identifies an installed plugin by it. The title the interface shows comes from the optional `displayName`, which is bilingual.

## Usage

- Bundled with Mio-Music: the app installs the plugins automatically on startup and updates them by version. Go to Settings → Plugins → Music List Plugins, click "Configure" on the plugin card, fill in the fields below, and run the connection test.
- Standalone install: choose "Install list plugin", then pick a local file or enter a URL.

To update an installed plugin, reinstall the script with the same name; its configuration is kept.

## Configuration

Every plugin takes a server address and credentials, plus an "Allow HTTP (unencrypted)" switch. Plain `http://` addresses are rejected unless the switch is on; loopback addresses such as `localhost` are exempt.

| Plugin | Server address | Credentials |
|---|---|---|
| Songloft | Server root, default port `58091`; include the sub-path if behind a reverse proxy | Username (default admin: `admin`) and password |
| Subsonic, Navidrome | Server root, without `/rest` | Username and password (sent only as a salted token, never in clear text); optional API version (default `1.16.1`) and client name |
| Jellyfin | Server root | Username and password, or an API key (Dashboard → API Keys); with an API key the username may be left empty and the first user is used |
| Emby | Server root, without `/emby` (e.g. `http://192.168.1.2:8096`) | Same as Jellyfin |
| Plex | Server root, default port `32400` | `X-Plex-Token` (required), optional music library name; the first music library is used when empty |

## Notes on behavior

- **Songloft** has no album or artist objects of its own. Albums, artists and genres are the server's song facets, and opening one lists the songs with exactly that value.
- **Emby and Jellyfin** share one code base: the two files differ only in the header and the `FLAVOR` line at the top (which also decides whether lyrics are offered). Apply any fix to both files.
- **Navidrome and Subsonic** both speak the Subsonic / OpenSubsonic API; `navidrome.list.js` adds artists and lyrics on top of it.

## As a submodule

This repository is mounted at `plugins/` in Mio-Music as a submodule, and the app embeds the scripts in the repository root with `include_str!`. The scripts must therefore stay in the repository root and must not be renamed. The `@name` in each script header identifies the bundled plugin, and `@version` decides whether the installed copy is updated on startup, so bump the version (in both the header and the exported `version`) whenever you change a script.

## Contract

A script exports `module.exports = { listPlugin: { name, displayName, version, author, description, config, sources, ...methods } }`, and its methods return camelCase JSON matching the host's `mio-music-sdk` types. The host provides `cerumusic.request`, `cerumusic.requestAll`, `cerumusic.storage`, `cerumusic.config`, `cerumusic.utils.crypto.md5` and so on; `cerumusic.locale` is the interface language (`zh-CN` or `en-US`); there is no file system, no process and no `require`. Limits: 30 seconds per call, at most 24 requests, response body ≤ 16 MB, script ≤ 1 MiB.

User-facing text goes through `tr(zh, en)`, defined at the top of each script from `cerumusic.locale`. Wrap every new string, including thrown error messages, and keep the `name` and the header `@name` unchanged.

## Verification status

Navidrome and Jellyfin have been exercised against their official public demo servers. Songloft, Plex and Emby have only been run end to end against local mock servers built from their documentation, not against real servers. Subsonic has no recorded verification against a real server. Jellyfin download URLs are unverified because the demo account lacks permission. The bilingual text was checked by loading all six scripts in the host runtime in both languages (metadata, form labels, discovery categories and the missing-configuration error) and by switching the language of an installed plugin; the English error messages and chart names on paths that need a live server were not run. There is no automated test suite in this repository.

## Contributing, security and license

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Please report security problems privately as described in [SECURITY.md](SECURITY.md).

Licensed under the [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`), the same as Mio-Music, which embeds these scripts. The server products these plugins connect to (Songloft, Subsonic, Navidrome, Jellyfin, Emby, Plex) are separate projects with their own licenses and trademarks; this repository is not affiliated with them.
