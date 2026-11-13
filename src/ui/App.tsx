import { useEffect, useRef, useState } from 'preact/hooks';
import { engine } from '../engine.ts';
import { outputSize } from '../geometry.ts';
import { setQuarter } from '../turn.ts';
import { canPromptInstall, isAndroid, isIOS, isMobile, isStandalone, onInstallChange, promptInstall } from '../install.ts';
import { deleteClip, deselect, duplicateClip, getState, importFiles, redo, restore, set, undo, useStore } from '../store.ts';
import { CanvasSheet } from './CanvasSheet.tsx';
import { HelpSheet } from './HelpSheet.tsx';
import { ExportSheet } from './ExportSheet.tsx';
import { Camera, Copy, Gear, Help, Plus, Redo, Shrink, Trash, Undo } from './icons.tsx';
import { FilePicker, PickLabel } from './Picker.tsx';
import { Preview } from './Preview.tsx';
import { Drawer, TabBar } from './Drawer.tsx';
import { SettingsSheet } from './SettingsSheet.tsx';
import { saveFrame } from '../frame.ts';
import { Timeline } from './Timeline.tsx';
import { browserInfo, checkSupport } from '../support.ts';

const support = checkSupport();

export function App() {
  const ready = useStore((s) => s.ready);
  const hasClips = useStore((s) => s.project.clips.length > 0);
  const sheet = useStore((s) => s.sheet);
  const focus = useStore((s) => s.focus);
  const locked = useStore((s) => s.locked);
  // Full preview of a wide project on a portrait screen: the whole screen is turned a quarter, so the wide picture fills it
  // (the buttons turn with it). A screen that is already wide (a tab turned by the browser) needs nothing.
  const wide = useStore((s) => {
    const o = outputSize(s.project);
    return o.w > o.h;
  });
  const [portrait, setPortrait] = useState(() => window.innerHeight >= window.innerWidth);
  useEffect(() => {
    const f = () => setPortrait(window.innerHeight >= window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const turn: 0 | 90 | -90 = focus && wide && portrait ? 90 : 0;
  useEffect(() => setQuarter(turn), [turn]);
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

  // drag files from the computer onto the page
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDropping(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDropping(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDropping(false);
      void importFiles([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', over);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', over);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  // the handle under the preview: drag to give the timeline or the preview more room
  useEffect(() => {
    const f = (e: Event) => setTlH((e as CustomEvent<number>).detail);
    window.addEventListener('pc-tl-height', f);
    return () => window.removeEventListener('pc-tl-height', f);
  }, []);

  // a tap on anything that is not a control (empty space around the canvas, the bars, the timeline background) selects nothing
  useEffect(() => {
    const tap = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (!el || !el.closest) return;
      if (el.closest('button, a, input, label, textarea, select, .strip-clip, .frame, .tl-scroll, .tl-bar, .tl-gap, .drawer, .tabbar, .sheet, .toast, .add-menu')) return;
      deselect();
    };
    // a picked gap is let go by the next touch anywhere (except on the gap itself, which holds the trash can)
    const letGo = (e: PointerEvent) => {
      if (!getState().gap) return;
      const el = e.target as Element | null;
      if (el?.closest?.('.tl-gap')) return;
      set({ gap: null });
    };
    // a tool that is open (a sheet or a drawer) is put away by a touch anywhere outside it, and that same touch
    // goes on to whatever is underneath: nothing sits in front of the app, so a swipe on the timeline still grabs it
    const putAway = (e: PointerEvent) => {
      const st = getState();
      if (st.sheet === 'none' && !st.drawer) return;
      const el = e.target as Element | null;
      if (el?.closest?.('.sheet, .drawer, .tabbar, .toast, .lock-veil, header.top')) return;
      if (st.sheet !== 'none') {
        if (st.exporting) return; // an export that is running is never cancelled by a stray touch
        set({ sheet: 'none' });
      }
      if (st.drawer) set({ drawer: null });
    };
    window.addEventListener('click', tap);
    window.addEventListener('pointerdown', letGo, true);
    window.addEventListener('pointerdown', putAway, true);
    return () => {
      window.removeEventListener('click', tap);
      window.removeEventListener('pointerdown', letGo, true);
      window.removeEventListener('pointerdown', putAway, true);
    };
  }, []);

  useEffect(() => {
    if (!hasClips) engine.pause();
  }, [hasClips]);

  return (
    <div class={`app ${locked ? 'locked' : ''} ${turn ? (turn > 0 ? 'turned-cw' : 'turned-ccw') : ''}`} style={{ '--tl-h': `${tlH}px` } as Record<string, string>}>
      <FilePicker />
      {locked && <div class="lock-veil" />}
      {!hasClips && (
        <header class="top">
          <span class="title plain">VideoWren</span>
          <button class="icon" onClick={() => set({ sheet: getState().sheet === 'help' ? 'none' : 'help' })} aria-label="How it works">
            <Help />
          </button>
          <button class="icon" onClick={() => set({ sheet: getState().sheet === 'settings' ? 'none' : 'settings' })} aria-label="Settings">
            <Gear />
          </button>
        </header>
      )}

      {busy && !hasClips && <div class="busy">{busy}</div>}

      {!support.ok ? (
        <Unsupported />
      ) : !ready ? null : hasClips ? (
        focus ? (
          <main class="editor focus">
            <Preview />
            <FocusBar />
          </main>
        ) : (
          <main class="editor">
            <Preview />
            <Timeline />
            <TabBar />
            <Drawer />
          </main>
        )
      ) : (
        <Empty />
      )}

      <div class={leaving ? 'sheet-out' : 'sheet-host'}>
      {shownSheet === 'export' && <ExportSheet onClose={() => set({ sheet: 'none' })} />}
      {shownSheet === 'help' && <HelpSheet onClose={() => set({ sheet: 'none' })} />}
      {shownSheet === 'canvas' && <CanvasSheet onClose={() => set({ sheet: 'none' })} />}
      {shownSheet === 'settings' && <SettingsSheet onClose={() => set({ sheet: 'none' })} />}

      </div>

      {dropping && <div class="drop-hint">Drop to add</div>}

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
      <img class="welcome-logo" src="./icons/icon.svg" alt="" width="132" height="132" />
      <h1>VideoWren</h1>
      <p class="slogan">A full video editor that fits in your pocket.</p>
      <p>Stack videos, pictures, text and sound on layers, then trim, crop, grade and time them on a real timeline. Small, offline and free. Everything happens on this device: no upload, no account, no watermark, and no trackers or analytics.</p>
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
      <h1>This browser can't run VideoWren yet</h1>
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

/** Preview focus: the picture fills the screen and only a few buttons stay (below it, or beside it when the phone is on its side). */
function FocusBar() {
  const selected = useStore((s) => s.selected);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const has = useStore((s) => !!s.project.clips[s.selected]);
  return (
    <div class="focus-bar">
      <button class="tl-btn" disabled={!has} onClick={() => (engine.pause(), deleteClip(selected))} aria-label="Delete the selected clip">
        <Trash />
      </button>
      <button class="tl-btn" disabled={!canUndo} onClick={undo} aria-label="Undo">
        <Undo />
      </button>
      <button class="tl-btn" disabled={!canRedo} onClick={redo} aria-label="Redo">
        <Redo />
      </button>
      <button class="tl-btn" disabled={!has} onClick={() => (engine.pause(), duplicateClip(selected))} aria-label="Duplicate the selected clip">
        <Copy />
      </button>
      <button class="tl-btn" onClick={() => (engine.pause(), void saveFrame())} aria-label="Save this frame as a picture">
        <Camera />
      </button>
      <button class="tl-btn exit" onClick={() => (window.dispatchEvent(new CustomEvent('pc-tl-height', { detail: 200 })), set({ focus: false }))} aria-label="Leave full preview">
        <Shrink />
      </button>
    </div>
  );
}
