# RustIRC on WebOS

The WebOS branch adds a browser client in `app.mjs`. Each call to `mount(host)` returns `{element, dispose}` synchronously. Each window owns its connection, nickname, active channel and message buffer.

The host supplies `irc.openChannel({signal})`, which returns an IRCv3 text WebSocket in CONNECTING or OPEN state. A production host must authenticate the WebOS session and authorize the configured owner subject before opening the server-selected TLS destination. The client registers a nickname, handles PING, joins a channel and exchanges messages. The standalone test supplies a private loopback transport. Desktop registration and production authorization are pending.

## Browser check

Run `python tests/webos/browser.py` in an environment with aiohttp, Playwright and Chromium. Set `CHROMIUM_BIN` to use an installed Chromium executable. The check exercises the mounted UI, a WebSocket adapter and a TCP fixture, including disposal. The screenshots are from the fixture.

[Desktop](docs/webos/desktop.png) · [Phone](docs/webos/phone.png)
