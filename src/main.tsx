import { render } from 'preact';
import './styles.css';
import { toast } from './store.ts';
import { App } from './ui/App.tsx';

render(<App />, document.getElementById('app')!);

// Offline support. Only in the production build: the dev server must never be cached.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('A new version is ready.', { label: 'Reload', run: () => location.reload() }, 15000);
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is a bonus; the editor still works without it */
    });
  });
}
