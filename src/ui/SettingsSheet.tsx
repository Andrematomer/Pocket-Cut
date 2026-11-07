import { useEffect, useState } from 'preact/hooks';
import { fmtBytes } from '../files.ts';
import { storageEstimate } from '../persist.ts';
import { canPromptInstall, isIOS, isStandalone, promptInstall } from '../install.ts';
import { discardProject, setPrefs, useStore } from '../store.ts';
import { browserInfo, checkSupport } from '../support.ts';
import { Fold } from './Fold.tsx';
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

      <Fold title="Preview quality" hint={<>Videos are previewed from a small copy so editing stays smooth. Pick a lower number if the preview stutters on an older phone. The exported video always uses the originals.</>}>
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
        
      </Fold>

      <Fold title="Keep the screen on" hint={<>"While working" keeps the screen awake only while a video is exporting or a preview copy is being made. With "Never", keep the app open and the phone awake yourself during exports.</>}>
        <div class="chips" role="group" aria-label="Keep the screen on">
          {([['on', 'Always'], ['work', 'While working'], ['off', 'Never']] as const).map(([v, label]) => (
            <button key={v} class={`chip ${prefs.awake === v ? 'on' : ''}`} aria-pressed={prefs.awake === v} onClick={() => setPrefs({ awake: v })}>
              {label}
            </button>
          ))}
        </div>
        
      </Fold>

      <Fold title="When playback ends" hint={<>Pause stays on the last frame. Stop goes back to the start. Loop plays again from the start. Return goes back to where the yellow line was when you pressed play.</>}>
        <div class="chips" role="group" aria-label="When playback ends">
          {([['pause', 'Pause'], ['stop', 'Stop'], ['loop', 'Loop'], ['return', 'Return']] as const).map(([v, label]) => (
            <button key={v} class={`chip ${prefs.onEnd === v ? 'on' : ''}`} aria-pressed={prefs.onEnd === v} onClick={() => setPrefs({ onEnd: v })}>
              {label}
            </button>
          ))}
        </div>
        
      </Fold>

      <Fold title="Timeline strip height" hint={<>Auto sizes the strips so every shown lane fits the timeline (between 50% and 200%). Manual lets you pick the height yourself.</>}>
        <div class="chips" role="group" aria-label="Timeline strip height mode">
          <button class={`chip ${prefs.rowAuto ? 'on' : ''}`} aria-pressed={prefs.rowAuto} onClick={() => setPrefs({ rowAuto: true })}>
            Auto
          </button>
          <button class={`chip ${!prefs.rowAuto ? 'on' : ''}`} aria-pressed={!prefs.rowAuto} onClick={() => setPrefs({ rowAuto: false })}>
            Manual
          </button>
        </div>
        {!prefs.rowAuto && (
          <div class="rate-slider">
            <div class="rate-now num">{Math.round(prefs.rowScale * 100)}%</div>
            <Slider label="Timeline strip height" value={prefs.rowScale} min={0.5} max={2} step={0.05} fineStep={0.01} snaps={[1]} snapPx={14} valueText={`${Math.round(prefs.rowScale * 100)} percent`} onChange={(v) => setPrefs({ rowScale: Math.round(v * 100) / 100 })} />
          </div>
        )}
      </Fold>

      <Fold title="Saved project" hint={<>
          Your last project (including the original videos) is kept on this device until you delete it. Nothing is ever uploaded.
          {usage && <span class="num"> Using {fmtBytes(usage.used)} of roughly {fmtBytes(usage.quota)} available.</span>}
        </>}>
        
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
      </Fold>

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

      <Fold title="Offline" hint={<>{offline ? 'Ready to work without a connection.' : 'Open the app once while online. After that it works offline.'}</>}>
        
        {!isStandalone && canPromptInstall() && (
          <button class="btn" onClick={() => void promptInstall()}>
            Install app
          </button>
        )}
        {!isStandalone && isIOS && <p class="hint">To install on iPhone or iPad: tap Share, then Add to Home Screen.</p>}
      </Fold>
    </Sheet>
  );
}
