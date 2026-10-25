# Security Policy

**English** · [简体中文](SECURITY.zh-CN.md)

## Supported versions

Only the latest version of each script (the one bundled with the latest [Mio-Music](https://github.com/Mio888888/Mio-Music) release) receives security fixes.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Report it privately instead:

1. Go to the [Security tab](https://github.com/Mio888888/mio-music-plugins/security) and choose **Report a vulnerability** ([direct link](https://github.com/Mio888888/mio-music-plugins/security/advisories/new)).
2. If that option is not available, open an issue titled "Security contact" that contains **no details**, and ask for a private channel.

Please include the plugin and its version, the server type and version, the steps to reproduce, and what an attacker could do. Do not include real passwords, tokens, access keys, private server addresses or other people's data.

This is a volunteer project. We will acknowledge a report as soon as we can, usually within a week, keep you informed while we work on it, and credit you in the release notes if you wish. Please give us reasonable time to release a fix before you disclose the problem publicly.

## What is in scope

- A password, token or access key sent to a host other than the server the user configured, written to a log, or shown in an error message.
- Plain `http://` addresses accepted without the user turning on "Allow HTTP (unencrypted)", or TLS checks weakened by a script.
- Requests that a server's response can redirect to another host, or that build a URL from server data in a way that lets the server steer them.
- Text or markup from a server that a script turns into something unsafe, for example an unescaped value placed into a URL or request.
- A script reaching beyond what the host sandbox gives it through a flaw in the script itself.

## What is out of scope

- Escaping the plugin sandbox itself. Report that to [Mio-Music](https://github.com/Mio888888/Mio-Music/security/advisories/new).
- Vulnerabilities in Songloft, Subsonic, Navidrome, Jellyfin, Emby or Plex themselves. Report them to those projects.
- The legality of the content a user's own server holds.
- Plugin configuration, including passwords, is stored by the app on the device and is not encrypted by the plugin. This is a known design limit; protect the device with the operating system's disk encryption.
- Playback, download and cover addresses carry the credential the server's protocol requires (for example Subsonic's salted token, Plex's `X-Plex-Token`, Jellyfin and Emby's access key). Keep such addresses private, and use HTTPS to your server.
