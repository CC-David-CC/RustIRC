// Each window owns one IRCv3 text WebSocket supplied by the authorized host.
export function mount(host) {
  const doc = host.document ?? document;
  const element = doc.createElement('section');
  element.className = 'window-content webos-irc';
  const root = element.attachShadow({mode: 'open'});
  root.innerHTML = `<link rel="stylesheet" href="${new URL('./webos.css', import.meta.url)}">
    <form class="connection"><label>Nickname <input name="nick" maxlength="24" required></label>
    <button>Connect</button></form><p role="status"></p>
    <form class="join"><label>Channel <input name="channel" placeholder="#channel" required></label>
    <button>Join</button></form><ol role="log" aria-label="Conversation"></ol>
    <form class="compose"><label>Message <input name="message" autocomplete="off" required></label>
    <button>Send</button></form>`;
  const connection = root.querySelector('.connection');
  const join = root.querySelector('.join');
  const compose = root.querySelector('.compose');
  const status = root.querySelector('[role=status]');
  const log = root.querySelector('[role=log]');
  const nickField = connection.elements.nick;
  const button = connection.querySelector('button');
  const live = new AbortController();
  let attempt, socket, nick = '', channel = '', pendingChannel = '';

  function enable(form, enabled) {
    for (const control of form.elements) control.disabled = !enabled;
  }
  function line(text) {
    const row = doc.createElement('li');
    row.textContent = text;
    log.append(row);
    if (log.children.length > 500) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
  }
  function reset(message) {
    attempt?.abort();
    attempt = null;
    const old = socket;
    socket = null;
    if (old && old.readyState < 2) old.close();
    channel = pendingChannel = '';
    nickField.disabled = false;
    button.textContent = 'Connect';
    enable(join, false);
    enable(compose, false);
    status.textContent = message;
  }
  function send(command) {
    if (socket?.readyState !== 1 || /[\r\n\0]/.test(command) ||
        new TextEncoder().encode(command).length > 510) return false;
    socket.send(command);
    return true;
  }
  // IRCv3 text transport delivers one complete IRC message in each WebSocket frame.
  function receive(event) {
    if (typeof event.data !== 'string' || event.data.length > 8192) return;
    const match = /^(?:@[^ ]+ +)?(?::([^ ]+) +)?([^ ]+)(?: +(.*))?$/.exec(event.data);
    if (!match) return;
    const [, prefix = '', command, rest = ''] = match;
    const from = prefix.split('!')[0];
    const fields = rest.match(/(?:^| )(:.*$|[^ ]+)/g)?.map(x => x.trimStart().replace(/^:/,'')) ?? [];
    const own = from.toLowerCase() === nick.toLowerCase();
    if (command === 'PING') { send('PONG :' + (fields.at(-1) ?? '')); return; }
    if (command === '001') {
      nick = fields[0];
      enable(join, true);
      status.textContent = 'Connected as ' + nick;
      line(fields.at(-1));
    } else if (command === 'JOIN' && own) {
      if (channel && channel !== fields[0]) send('PART ' + channel);
      channel = fields[0]; pendingChannel = '';
      enable(compose, true);
      status.textContent = 'Joined ' + channel;
    } else if (command === 'NICK' && own) {
      nick = fields[0];
    } else if ((command === 'KICK' && fields[1]?.toLowerCase() === nick.toLowerCase() ||
                command === 'PART' && own) && fields[0] === channel) {
      channel = ''; enable(compose, false); status.textContent = 'Channel left';
    } else if (command === 'PRIVMSG' || command === 'NOTICE') {
      line((fields[0] ?? '') + ' · ' + from + ' · ' + (fields[1] ?? ''));
    } else if (/^[45]\d\d$/.test(command) || command === 'ERROR') {
      pendingChannel = ''; status.textContent = fields.at(-1) || command;
    }
  }

  connection.addEventListener('submit', async event => {
    event.preventDefault();
    if (attempt) { reset('Disconnected'); return; }
    nick = nickField.value.trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,23}$/.test(nick)) {
      status.textContent = 'Use a nickname starting with a letter, up to 24 characters.'; return;
    }
    const current = new AbortController();
    attempt = current;
    status.textContent = 'Connecting…'; button.textContent = 'Disconnect'; nickField.disabled = true;
    try {
      const ws = await host.irc.openChannel({signal: current.signal});
      if (current.signal.aborted) { ws.close(); return; }
      socket = ws;
      const opts = {signal: current.signal};
      ws.addEventListener('message', receive, opts);
      ws.addEventListener('close', () => reset('Disconnected'), opts);
      ws.addEventListener('error', () => reset('IRC connection failed'), opts);
      function register() {
        send('NICK ' + nick);
        send('USER ' + nick + ' 0 * :WebOS RustIRC');
      }
      if (ws.readyState === 1) register();
      else if (ws.readyState === 0) ws.addEventListener('open', register, {...opts, once:true});
      else reset('IRC connection closed');
    } catch {
      if (!current.signal.aborted) reset('IRC connection unavailable');
    }
  }, {signal: live.signal});
  join.addEventListener('submit', event => {
    event.preventDefault();
    const target = join.elements.channel.value.trim();
    if (!/^#[^\s,:\x00-\x1f]{1,49}$/u.test(target)) { status.textContent = 'Enter a channel such as #webos.'; return; }
    if (target === channel || target === pendingChannel) return;
    if (send('JOIN ' + target)) { pendingChannel = target; status.textContent = 'Joining ' + target + '…'; }
  }, {signal: live.signal});
  compose.addEventListener('submit', event => {
    event.preventDefault();
    const text = compose.elements.message.value;
    if (!channel || !text.trim()) return;
    if (!send('PRIVMSG ' + channel + ' :' + text)) { status.textContent = 'Message is too long or the connection has closed.'; return; }
    line(channel + ' · ' + nick + ' · ' + text); compose.reset();
  }, {signal: live.signal});
  reset('Choose a nickname to connect');
  if (!host.irc?.openChannel) {
    button.disabled = true;
    status.textContent = 'IRC access is unavailable in this session.';
  }
  return {element, dispose() { live.abort(); reset('Closed'); }};
}
