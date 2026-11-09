import { browser } from 'wxt/browser';
import { EngineHost } from '@/engine/offscreen/lmstudio-host';

const host = new EngineHost();
browser.runtime.onConnect.addListener((port) => {
  host.handlePort(port);
});
