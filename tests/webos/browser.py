"""Loopback-only transport and real Chromium check. Requires aiohttp and playwright."""
import asyncio
import os
from pathlib import Path

from aiohttp import web, WSMsgType
from playwright.async_api import async_playwright, expect

APP = Path(__file__).resolve().parents[2]
HARNESS = """<body style="height:620px"><script type="module">
import {mount} from './app.mjs';
window.app=mount({document,irc:{openChannel:()=>new WebSocket('ws://'+location.host+'/fixture','text.ircv3.net')}});
document.body.append(app.element);
</script></body>"""


async def main():
    commands = []
    disconnected = asyncio.Event()

    async def ircd(reader, writer):
        try:
            while raw := await reader.readline():
                line = raw.decode().rstrip('\r\n')
                commands.append(line)
                if line.startswith('USER '):
                    writer.write(b':fixture 001 Tester :Welcome\r\nPING :proof\r\n')
                elif line == 'JOIN #local':
                    writer.write(b':Tester!user@local JOIN :#local\r\n')
                elif line == 'PRIVMSG #local :hello local':
                    writer.write(b':Peer!user@local PRIVMSG #local :hello back\r\n')
                await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()
            disconnected.set()

    tcp = await asyncio.start_server(ircd, '127.0.0.1', 0)

    async def fixture(request):
        if request.headers.get('Origin') != origin:
            raise web.HTTPForbidden()
        ws = web.WebSocketResponse(protocols=['text.ircv3.net'])
        await ws.prepare(request)
        reader, writer = await asyncio.open_connection('127.0.0.1', tcp.sockets[0].getsockname()[1])

        async def downstream():
            while line := await reader.readline():
                await ws.send_str(line.decode().rstrip('\r\n'))

        pump = asyncio.create_task(downstream())
        try:
            async for message in ws:
                if message.type == WSMsgType.TEXT and not any(c in message.data for c in '\r\n\0'):
                    writer.write((message.data + '\r\n').encode())
                    await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()
            pump.cancel()
            await asyncio.gather(pump, return_exceptions=True)
        return ws

    async def index(request):
        return web.Response(text=HARNESS, content_type='text/html')

    async def asset(request):
        return web.FileResponse(APP / request.match_info['name'])

    api = web.Application()
    api.router.add_get('/', index)
    api.router.add_get('/{name:app\\.mjs|webos\\.css}', asset)
    api.router.add_get('/fixture', fixture)
    runner = web.AppRunner(api)
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0)
    await site.start()
    origin = f'http://127.0.0.1:{runner.addresses[0][1]}'
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(executable_path=os.getenv('CHROMIUM_BIN'))
            try:
                page = await browser.new_page()
                await page.goto(origin)
                await page.get_by_label('Nickname').fill('Tester')
                await page.get_by_role('button', name='Connect', exact=True).click()
                await expect(page.get_by_role('status')).to_have_text('Connected as Tester')
                await page.get_by_label('Channel', exact=True).fill('#local')
                await page.get_by_role('button', name='Join').click()
                await expect(page.get_by_role('status')).to_have_text('Joined #local')
                await page.get_by_label('Message').fill('hello local')
                await page.get_by_role('button', name='Send').click()
                await expect(page.get_by_role('log')).to_contain_text('Peer · hello back')
                assert 'PONG :proof' in commands
                if directory := os.getenv('IRC_SCREENSHOTS'):
                    for name, width, height in [('desktop', 950, 560), ('phone', 390, 650)]:
                        await page.set_viewport_size({'width': width, 'height': height})
                        await page.locator('body').evaluate("(el) => { el.style.height='calc(100dvh - 16px)' }")
                        await page.locator('.webos-irc').screenshot(path=Path(directory) / f'{name}.png')

                await page.evaluate('app.dispose(); app.dispose()')
                await asyncio.wait_for(disconnected.wait(), 4)
                print('PASS mount, registration, PING/PONG, JOIN, both message directions, double dispose and TCP close')
            finally:
                await browser.close()
    finally:
        await runner.cleanup()
        tcp.close()
        await tcp.wait_closed()


if __name__ == '__main__':
    asyncio.run(main())
