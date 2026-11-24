export class DemoChannel extends EventTarget {
  readyState = 1;
  #nick = '';
  #joined = new Set();
  #onDelivery;

  constructor(onDelivery) {
    super();
    this.#onDelivery = onDelivery;
  }

  #receive(text) {
    queueMicrotask(() => {
      if (this.readyState === 1) this.dispatchEvent(new MessageEvent('message', { data: text }));
    });
  }

  send(line) {
    if (this.readyState !== 1) return;
    const [command, target] = line.split(' ', 2);
    if (command === 'NICK') {
      this.#nick = target;
    } else if (command === 'USER') {
      this.#receive(':demo 001 ' + this.#nick + ' :Welcome to the local IRC simulation.');
      this.#receive('PING :local');
    } else if (command === 'JOIN') {
      this.#joined.add(target);
      this.#receive(':' + this.#nick + '!demo@browser JOIN :' + target);
    } else if (command === 'PART') {
      this.#joined.delete(target);
    } else if (command === 'PRIVMSG' && this.#joined.has(target)) {
      const text = line.slice('PRIVMSG '.length + target.length + 2);
      this.#receive(':DemoPeer!demo@browser PRIVMSG ' + target + ' :Received in ' + target + ': ' + text);
      this.#onDelivery?.();
    }
  }

  close() {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.#joined.clear();
    this.dispatchEvent(new Event('close'));
  }
}
