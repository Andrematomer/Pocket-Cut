import { useEffect, useRef, useState } from 'preact/hooks';
import { engine } from '../engine.ts';
import { canPromptInstall, isAndroid, isIOS, isMobile, isStandalone, onInstallChange, promptInstall } from '../install.ts';
import { redo, restore, set, undo, useStore } from '../store.ts';
import { ASPECT_LABEL, CanvasSheet } from './CanvasSheet.tsx';
import { HelpSheet } from './HelpSheet.tsx';
import { ExportSheet } from './ExportSheet.tsx';
import { Gear, Help, Plus, Redo, Undo } from './icons.tsx';
import { FilePicker, PickLabel } from './Picker.tsx';
import { Preview } from './Preview.tsx';
import { Drawer, TabBar } from './Drawer.tsx';
import { SettingsSheet } from './SettingsSheet.tsx';
import { Timeline } from './Timeline.tsx';
import { browserInfo, checkSupport } from '../support.ts';

const support = checkSupport();

export function App() {
  const ready = useStore((s) => s.ready);
  const hasClips = useStore((s) => s.project.clips.length > 0);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const aspect = useStore((s) => s.project.settings.aspect);
  const sheet = useStore((s) => s.sheet);
  // a closed sheet stays for a moment so it can slide out
  const [lastSheet, setLastSheet] = useState<typeof sheet>('none');
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (sheet !== 'none') {
      setLastSheet(sheet);
      setLeaving(false);
      return;
    }
    if (lastSheet === 'none') return;
    setLeaving(true);
    const id = window.setTimeout(() => (setLastSheet('none'), setLeaving(false)), 190);
    return () => clearTimeout(id);
  }, [sheet]);
  const shownSheet = sheet !== 'none' ? sheet : lastSheet;
  const busy = useStore((s) => s.busy);
  const toast = useStore((s) => s.toast);
  const [tlH, setTlH] = useState(() => {
    try {
      return Number(localStorage.getItem('pocket-cut-nla:tl-height')) || 200;
    } catch {
      return 200;
    }
  });

  useEffect(() => {
    void restore();
  }, []);

  // the handle under the preview: drag to give the timeline or the preview more room
  useEffect(() => {
    const f = (e: Event) => setTlH((e as CustomEvent<number>).detail);
    window.addEventListener('pc-tl-height', f);
    return () => window.removeEventListener('pc-tl-height', f);
  }, []);

  useEffect(() => {
    if (!hasClips) engine.pause();
  }, [hasClips]);

  return (
    <div class="app" style={{ '--tl-h': `${tlH}px` } as Record<string, string>}>
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
        {hasClips && (
          <button class="export" onClick={() => set({ sheet: 'export' })}>
            Export
          </button>
        )}
      </header>

      {busy && !hasClips && <div class="busy">{busy}</div>}

      {!support.ok ? (
        <Unsupported />
      ) : !ready ? null : hasClips ? (
        <main class="editor">
          <Preview />
          <Splitter />
          <Timeline />
          <TabBar />
          <Drawer />
        </main>
      ) : (
        <Empty />
      )}

      <div class={leaving ? 'sheet-out' : 'sheet-host'}>
      {shownSheet === 'export' && <ExportSheet onClose={() => set({ sheet: 'none' })} />}
      {shownSheet === 'help' && <HelpSheet onClose={() => set({ sheet: 'none' })} />}
      {shownSheet === 'canvas' && <CanvasSheet onClose={() => set({ sheet: 'none' })} />}
      {shownSheet === 'settings' && <SettingsSheet onClose={() => set({ sheet: 'none' })} />}

      </div>

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
      <h1>A full video editor that fits in your pocket</h1>
      <p>Stack videos, pictures, text and sound on layers, then trim, crop, grade and time them on a real timeline. Everything happens on this device: no upload, no account, no watermark.</p>
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

const isChromium = /Chrome\/|Edg\//.test(navigator.userAgent) && !isMobile;

/** Shown on the welcome screen to people using it in a browser tab (phone, tablet or computer). */
function InstallHint() {
  const [, tick] = useState(0);
  useEffect(() => onInstallChange(() => tick((n) => n + 1)), []);
  if (isStandalone) return null;
  const body = isIOS ? (
    <ol>
      <li>Open this page in Safari.</li>
      <li>Tap the Share button.</li>
      <li>Choose Add to Home Screen.</li>
    </ol>
  ) : canPromptInstall() ? (
    <button class="btn" onClick={() => void promptInstall()}>
      Install app
    </button>
  ) : isAndroid ? (
    <ol>
      <li>Open the browser menu (three dots).</li>
      <li>Tap Install app or Add to Home screen.</li>
    </ol>
  ) : isChromium ? (
    <p>Look for the install icon at the right end of the address bar, or open the browser menu and choose Install.</p>
  ) : null;
  if (!body) return null;
  return (
    <section class="install">
      <h2>Install it for the best experience</h2>
      <p>Installed, it opens full screen, works without internet and keeps your project safe.</p>
      {body}
    </section>
  );
}

/** A grab handle between the preview and the timeline: drag it up or down to trade space between them. */
function Splitter() {
  const drag = useRef<{ id: number; y0: number; h0: number } | null>(null);
  const cur = () => parseFloat(getComputedStyle(document.querySelector('.app')!).getPropertyValue('--tl-h')) || 200;
  const send = (h: number) => window.dispatchEvent(new CustomEvent('pc-tl-height', { detail: h }));
  return (
    <div
      class="splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Drag to change the size of the preview"
      onPointerDown={(e) => {
        drag.current = { id: e.pointerId, y0: e.clientY, h0: cur() };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        send(Math.round(Math.max(110, Math.min(window.innerHeight * 0.72, d.h0 + (d.y0 - e.clientY)))));
      }}
      onPointerUp={() => {
        drag.current = null;
        try {
          localStorage.setItem('pocket-cut-nla:tl-height', String(Math.round(cur())));
        } catch {
          /* ignore */
        }
      }}
      onPointerCancel={() => (drag.current = null)}
    >
      <i />
    </div>
  );
}
