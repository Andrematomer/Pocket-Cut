import { useEffect, useState } from 'preact/hooks';
import { fmtBytes } from '../files.ts';
import { storageEstimate } from '../persist.ts';
import { canPromptInstall, isIOS, isStandalone, promptInstall } from '../install.ts';
import { discardProject, setPrefs, useStore } from '../store.ts';
import { browserInfo, checkSupport } from '../support.ts';
import { Sheet } from './Sheet.tsx';

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const hasProject = useStore((s) => s.project.clips.length > 0);
  const prefs = useStore((s) => s.prefs);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const offline = !!navigator.serviceWorker?.controller;

  useEffect(() => {
    void storageEstimate().then(setUsage);
  }, []);

  return (
    <Sheet title="Settings" onClose={onClose}>
      <section>
        <h3>New pictures stay for</h3>
        <div class="chips" role="group" aria-label="Default picture duration">
          {[2, 3, 5, 7, 10].map((n) => (
            <button key={n} class={`chip num ${prefs.imageSeconds === n ? 'on' : ''}`} aria-pressed={prefs.imageSeconds === n} onClick={() => setPrefs({ imageSeconds: n })}>
              {n} s
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Preview quality</h3>
        <div class="chips" role="group" aria-label="Preview size">
          {[144, 240, 360].map((n) => (
            <button
              key={n}
              class={`chip num ${prefs.previewLong === n ? 'on' : ''}`}
              aria-pressed={prefs.previewLong === n}
              onClick={() => {
                if (prefs.previewLong === n) return;
                setPrefs({ previewLong: n });
              }}
            >
              {n}p
            </button>
          ))}
        </div>
        <p class="hint">Videos are previewed from a small copy so editing stays smooth. Pick a lower number if the preview stutters on an older phone. A new size applies to videos you add from now on, not to the ones already in the project. The exported video always uses the originals.</p>
      </section>

      <section>
        <h3>Keep the screen on</h3>
        <div class="chips" role="group" aria-label="Keep the screen on">
          {([['on', 'Always'], ['work', 'While working'], ['off', 'Never']] as const).map(([v, label]) => (
            <button key={v} class={`chip ${prefs.awake === v ? 'on' : ''}`} aria-pressed={prefs.awake === v} onClick={() => setPrefs({ awake: v })}>
              {label}
            </button>
          ))}
        </div>
        <p class="hint">"While working" keeps the screen awake only while a video is exporting or a preview copy is being made. With "Never", keep the app open and the phone awake yourself during exports.</p>
      </section>

      <section>
        <h3>Saved project</h3>
        <p class="hint">
          Your last project (including the original videos) is kept on this device until you delete it. Nothing is ever uploaded.
          {usage && <span class="num"> Using {fmtBytes(usage.used)} of roughly {fmtBytes(usage.quota)} available.</span>}
        </p>
        {!confirm ? (
          <button class="btn danger" disabled={!hasProject} onClick={() => setConfirm(true)}>
            Delete saved project
          </button>
        ) : (
          <div class="row">
            <button
              class="btn danger"
              onClick={async () => {
                await discardProject();
                onClose();
              }}
            >
              Yes, delete it
            </button>
            <button class="btn" onClick={() => setConfirm(false)}>
              Keep it
            </button>
          </div>
        )}
      </section>

      <section>
        <h3>This device</h3>
        <ul class="checks">
          {checkSupport().rows.map((r) => (
            <li key={r.name} class={r.ok ? 'yes' : 'no'}>
              {r.ok ? '✓' : '✗'} {r.name}
              {!r.ok && <small> {r.missing}</small>}
            </li>
          ))}
        </ul>
        <p class="hint small-print">{browserInfo()}</p>
      </section>

      <section>
        <h3>Offline</h3>
        <p class="hint">{offline ? 'Ready to work without a connection.' : 'Open the app once while online. After that it works offline.'}</p>
        {!isStandalone && canPromptInstall() && (
          <button class="btn" onClick={() => void promptInstall()}>
            Install app
          </button>
        )}
        {!isStandalone && isIOS && <p class="hint">To install on iPhone or iPad: tap Share, then Add to Home Screen.</p>}
      </section>
    </Sheet>
  );
}
