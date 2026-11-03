import { useEffect, useState } from 'preact/hooks';
import { engine } from '../engine.ts';
import { canPromptInstall, isAndroid, isIOS, isMobile, isStandalone, onInstallChange, promptInstall } from '../install.ts';
import { redo, restore, set, undo, useStore } from '../store.ts';
import { ASPECT_LABEL, CanvasSheet } from './CanvasSheet.tsx';
import { HelpSheet } from './HelpSheet.tsx';
import { ExportSheet } from './ExportSheet.tsx';
import { Gear, Help, Plus, Redo, Undo } from './icons.tsx';
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
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
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
        {!hasClips && <span class="title plain">Pocket Cut</span>}
        <button class="icon" onClick={() => set({ sheet: 'help' })} aria-label="How it works">
          <Help />
        </button>
        {hasClips && (
          <button class="canvas-btn num" onClick={() => set({ sheet: 'canvas' })} aria-label={`Canvas shape: ${ASPECT_LABEL[aspect]}`}>
            <i class="canvas-ico" aria-hidden="true" />
            {ASPECT_LABEL[aspect]}
          </button>
        )}
        {hasClips && <span class="spacer" />}
        {hasClips && (
          <>
            <button class="icon" disabled={!canUndo} onClick={undo} aria-label="Undo">
              <Undo />
            </button>
            <button class="icon" disabled={!canRedo} onClick={redo} aria-label="Redo">
              <Redo />
            </button>
          </>
        )}
        <button class="icon" onClick={() => set({ sheet: 'settings' })} aria-label="Settings">
          <Gear />
        </button>
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
      <InstallHint />
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

/** Shown on the welcome screen to people using it in a browser tab on a phone. */
function InstallHint() {
  const [, tick] = useState(0);
  useEffect(() => onInstallChange(() => tick((n) => n + 1)), []);
  if (isStandalone || !isMobile) return null;
  return (
    <section class="install">
      <h2>Install it for the best experience</h2>
      <p>Installed, it opens full screen, works without internet and keeps your project safe.</p>
      {isIOS ? (
        <ol>
          <li>Open this page in Safari.</li>
          <li>Tap the Share button.</li>
          <li>Choose Add to Home Screen.</li>
        </ol>
      ) : canPromptInstall() ? (
        <button class="btn" onClick={() => void promptInstall()}>
          Install app
        </button>
      ) : (
        isAndroid && (
          <ol>
            <li>Open the browser menu (three dots).</li>
            <li>Tap Install app or Add to Home screen.</li>
          </ol>
        )
      )}
    </section>
  );
}
