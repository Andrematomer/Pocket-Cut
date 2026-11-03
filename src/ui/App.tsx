import { useEffect } from 'preact/hooks';
import { engine } from '../engine.ts';
import { restore, set, setName, useStore } from '../store.ts';
import { ASPECT_LABEL, CanvasSheet } from './CanvasSheet.tsx';
import { ClipMenu } from './ClipMenu.tsx';
import { HelpSheet } from './HelpSheet.tsx';
import { ExportSheet } from './ExportSheet.tsx';
import { Help, Info, Plus } from './icons.tsx';
import { FilePicker, PickLabel } from './Picker.tsx';
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
  const aspect = useStore((s) => s.project.settings.aspect);
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
      <FilePicker />
      <header class="top">
        {hasClips ? (
          <input class="title" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} aria-label="Project name" maxLength={60} />
        ) : (
          <span class="title plain">Pocket Cut</span>
        )}
        <button class="icon" onClick={() => set({ sheet: 'settings' })} aria-label="About and storage">
          <Info />
        </button>
        <button class="icon" onClick={() => set({ sheet: 'help' })} aria-label="How it works">
          <Help />
        </button>
        {hasClips && (
          <button class="canvas-btn num" onClick={() => set({ sheet: 'canvas' })} aria-label={`Canvas shape: ${ASPECT_LABEL[aspect]}`}>
            <i class="canvas-ico" aria-hidden="true" />
            {ASPECT_LABEL[aspect]}
          </button>
        )}
        <button class="export" disabled={!hasClips} onClick={() => set({ sheet: 'export' })}>
          Export
        </button>
      </header>

      {busy && !hasClips && <div class="busy">{busy}</div>}

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
      {sheet === 'help' && <HelpSheet onClose={() => set({ sheet: 'none' })} />}
      {sheet === 'clip' && <ClipMenu onClose={() => set({ sheet: 'none' })} />}
      {sheet === 'canvas' && <CanvasSheet onClose={() => set({ sheet: 'none' })} />}
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
      <h1>Quick edits for your videos and pictures</h1>
      <p>Trim, speed up, place and join clips. It all happens on this device, with no upload and no watermark.</p>
      <PickLabel class="cta">
        <Plus /> Choose videos or pictures
      </PickLabel>
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
