import { useEffect, useState } from 'preact/hooks';
import { fmtBytes } from '../files.ts';
import { storageEstimate } from '../persist.ts';
import { canPromptInstall, isIOS, isStandalone, promptInstall } from '../install.ts';
import { discardProject, setPrefs, useStore } from '../store.ts';
import { browserInfo, checkSupport } from '../support.ts';
import { Hint } from './Hint.tsx';
import { Sheet } from './Sheet.tsx';
import { Slider } from './Slider.tsx';

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
        <Hint>Videos are previewed from a small copy so editing stays smooth. Pick a lower number if the preview stutters on an older phone. The exported video always uses the originals.</Hint>
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
        <Hint>"While working" keeps the screen awake only while a video is exporting or a preview copy is being made. With "Never", keep the app open and the phone awake yourself during exports.</Hint>
      </section>

      <section>
        <h3>When playback ends</h3>
        <div class="chips" role="group" aria-label="When playback ends">
          {([['pause', 'Pause'], ['stop', 'Stop'], ['loop', 'Loop']] as const).map(([v, label]) => (
            <button key={v} class={`chip ${prefs.onEnd === v ? 'on' : ''}`} aria-pressed={prefs.onEnd === v} onClick={() => setPrefs({ onEnd: v })}>
              {label}
            </button>
          ))}
        </div>
        <Hint>Pause stays on the last frame. Stop goes back to the start. Loop plays again from the start.</Hint>
      </section>

      <section>
        <h3>Timeline strip height</h3>
        <div class="rate-slider">
          <div class="rate-now num">{Math.round(prefs.rowScale * 100)}%</div>
          <Slider label="Timeline strip height" value={prefs.rowScale} min={0.5} max={2} step={0.05} fineStep={0.01} snaps={[1]} snapPx={14} valueText={`${Math.round(prefs.rowScale * 100)} percent`} onChange={(v) => setPrefs({ rowScale: Math.round(v * 100) / 100 })} />
        </div>
        <Hint>Makes the strips on the timeline thinner or taller. Thin strips help when you work with many layers.</Hint>
      </section>

      <section>
        <h3>Saved project</h3>
        <Hint>
          Your last project (including the original videos) is kept on this device until you delete it. Nothing is ever uploaded.
          {usage && <span class="num"> Using {fmtBytes(usage.used)} of roughly {fmtBytes(usage.quota)} available.</span>}
        </Hint>
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
        <Hint>{offline ? 'Ready to work without a connection.' : 'Open the app once while online. After that it works offline.'}</Hint>
        {!isStandalone && canPromptInstall() && (
          <button class="btn" onClick={() => void promptInstall()}>
            Install app
          </button>
        )}
        {!isStandalone && isIOS && <Hint>To install on iPhone or iPad: tap Share, then Add to Home Screen.</Hint>}
      </section>
    </Sheet>
  );
}
