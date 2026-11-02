import { Component, render, type ComponentChildren } from 'preact';
import './styles.css';
import { toast } from './store.ts';
import { App } from './ui/App.tsx';

/** If something in the UI throws, show it instead of a blank screen. */
class Boundary extends Component<{ children: ComponentChildren }, { error: Error | null }> {
  state = { error: null as Error | null };
  componentDidCatch(error: Error) {
    this.setState({ error });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main class="fatal">
        <h1>Something broke</h1>
        <p>If this keeps happening, send this text to the developer:</p>
        <pre>
          {navigator.userAgent}
          {'\n\n'}
          {String(this.state.error.stack || this.state.error.message || this.state.error).slice(0, 1500)}
        </pre>
        <button class="btn" onClick={() => location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}

render(
  <Boundary>
    <App />
  </Boundary>,
  document.getElementById('app')!,
);
document.getElementById('boot')?.remove();

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
