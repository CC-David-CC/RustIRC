import { mount as mountClient } from './app.mjs';
import { DemoChannel } from './demo/transport.mjs';

export function mountDemo(host, { delivery = false } = {}) {
  const doc = host.document ?? document;
  const lifetime = new AbortController();
  const status = doc.createElement('p');
  status.setAttribute('aria-live', 'polite');
  status.dataset.serverDelivery = '';
  const client = mountClient({
    ...host,
    irc: { openChannel: () => new DemoChannel(delivery ? reportDelivery : undefined) },
  });

  async function reportDelivery() {
    status.textContent = '';
    try {
      const response = await fetch('/webos-demo-message', {
        method: 'POST', credentials: 'omit', signal: lifetime.signal,
      });
      status.textContent = await response.text() === 'no connection' ? 'no connection' : 'Delivery check unavailable';
    } catch (error) {
      if (!lifetime.signal.aborted) status.textContent = 'Delivery check unavailable';
    }
  }

  if (delivery) {
    client.element.shadowRoot.append(status);
    const note = doc.createElement('p');
    note.textContent = 'Simulated IRC connection';
    client.element.shadowRoot.prepend(note);
  }
  return {
    element: client.element,
    dispose() {
      lifetime.abort();
      client.dispose();
    },
  };
}

export function mount(host) {
  return mountDemo(host, { delivery: true });
}
