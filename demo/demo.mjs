import { mountDemo } from '../webos-demo.mjs';

const client = mountDemo({ document });
document.getElementById('client').append(client.element);
window.addEventListener('pagehide', () => client.dispose(), { once: true });
