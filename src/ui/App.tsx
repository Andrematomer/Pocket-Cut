import { useEffect } from 'preact/hooks';
import { pickVideos } from '../files.ts';
import { engine } from '../engine.ts';
import { restore, set, setName, useStore } from '../store.ts';
import { ExportSheet } from './ExportSheet.tsx';
import { Gear, Plus } from './icons.tsx';
import { Preview, Transport } from './Preview.tsx';
import { SettingsSheet } from './SettingsSheet.tsx';
import { Strip } from './Strip.tsx';
import { browserInfo, checkSupport } from '../support.ts';
import { Tools } from './Tools.tsx';

const support = checkSupport();

export function App() {
  const ready = useStore((s) => s.ready);
  const hasClips = useStore((s) => s.project.clips.length > 0);
  const name = useStore((s) => s.project.name);
  const sheet = useStore((s) => s.sheet);
  const busy = useStore((s) => s.busy);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    void restore();
  }, []);

  useEffect(() => {
    if (!hasClips) engine.pause();
  }, [hasClips]);

  return (
    <div class="app">
      <header class="top">
        {hasClips ? (
          <input class="title" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} aria-label="Project name" maxLength={60} />
        ) : (
          <span class="title plain">Pocket Cut</span>
        )}
        <button class="icon" onClick={() => set({ sheet: 'settings' })} aria-label="About and storage">
          <Gear />
        </button>
        <button class="export" disabled={!hasClips} onClick={() => set({ sheet: 'export' })}>
          Export
        </button>
      </header>

      {busy && <div class="busy">{busy}</div>}

      {!support.ok ? (
        <Unsupported />
      ) : !ready ? null : hasClips ? (
        <main class="editor">
          <Preview />
          <Transport />
          <Strip />
          <Tools />
        </main>
      ) : (
        <Empty />
      )}

      {sheet === 'export' && <ExportSheet onClose={() => set({ sheet: 'none' })} />}
      {sheet === 'settings' && <SettingsSheet onClose={() => set({ sheet: 'none' })} />}

      {toast && (
        <div class="toast" role="status">
          <span>{toast.text}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.run();
                set({ toast: null });
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Empty() {
  return (
    <main class="empty">
      <div class="reel" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <h1>Trim, turn, crop and join videos</h1>
      <p>Cut a long video into 60-second parts for stories. It all happens on this device, with no upload and no watermark.</p>
      <button class="cta" onClick={pickVideos}>
        <Plus /> Choose videos
      </button>
      <p class="wip">Work in progress. Not ready to use yet: things may break, so keep your original videos.</p>
    </main>
  );
}

function Unsupported() {
  return (
    <main class="fatal">
      <h1>This browser can't run Pocket Cut yet</h1>
      <p>It needs video encoding (WebCodecs). On iPhone and iPad that means a recent iOS (16.4 or newer) with Safari. On Android, use a recent Chrome.</p>
      <ul class="checks">
        {support.rows.map((r) => (
          <li key={r.name} class={r.ok ? 'yes' : 'no'}>
            {r.ok ? '✓' : '✗'} {r.name}
          </li>
        ))}
      </ul>
      <pre>{browserInfo()}</pre>
    </main>
  );
}
