import { useRef, useState } from 'preact/hooks';
import { FriendlyError, exportProject, type ExportProgress, type ExportResult } from '../exporter.ts';
import { engine } from '../engine.ts';
import { RATE_STOPS, estimateBytes, fmtMbps, videoBitrate } from '../bitrate.ts';
import { fmtBytes, saveBlob, shareFiles } from '../files.ts';
import { outputSize } from '../geometry.ts';
import { blobFor, setName, setSettings, useStore } from '../store.ts';
import { fmtTime, planParts, totalOf } from '../timeline.ts';
import type { ExportSettings } from '../types.ts';
import { Check, Download, Share } from './icons.tsx';
import { Sheet } from './Sheet.tsx';
import { Slider } from './Slider.tsx';

const SPLITS: { label: string; value: number | null }[] = [
  { label: 'Off', value: null },
  { label: '15 s', value: 15 },
  { label: '30 s', value: 30 },
  { label: '60 s', value: 60 },
];

const QUALITIES: { label: string; value: ExportSettings['quality'] }[] = [
  { label: 'Low', value: 'small' },
  { label: 'Balanced', value: 'medium' },
  { label: 'High', value: 'high' },
];
const nearestStop = (m: number): number => RATE_STOPS.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));

function Chips<T>({ options, value, onPick, label }: { options: { label: string; value: T }[]; value: T; onPick: (v: T) => void; label: string }) {
  return (
    <div class="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.label} class={`chip num ${o.value === value ? 'on' : ''}`} aria-pressed={o.value === value} onClick={() => onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Phase = { name: 'setup' } | { name: 'running'; progress: ExportProgress } | { name: 'done'; result: ExportResult } | { name: 'error'; message: string };

export function ExportSheet({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const [phase, setPhase] = useState<Phase>({ name: 'setup' });
  const [custom, setCustom] = useState(false);
  const [customFps, setCustomFps] = useState(() => ![24, 30, 60].includes(project.settings.fps));
  const [customRate, setCustomRate] = useState(() => project.settings.bitrateMbps !== null);
  const abort = useRef<AbortController | null>(null);
  const [note, setNote] = useState('');

  const s = project.settings;
  const total = totalOf(project.clips);
  const parts = planParts(total, s.splitSeconds, s.equalParts, s.fps);
  const size = outputSize(project);
  const isCustomValue = s.splitSeconds !== null && !SPLITS.some((x) => x.value === s.splitSeconds);
  const showSlider = customRate;
  const vbps = videoBitrate(s, size.w, size.h);
  const withSound = project.clips.some((c) => c.volume > 0 && project.media[c.mediaId]?.hasAudio);
  const longest = parts.reduce((m, p) => Math.max(m, p.end - p.start), 0);

  const run = async () => {
    engine.pause();
    const ctl = new AbortController();
    abort.current = ctl;
    setNote('');
    setPhase({ name: 'running', progress: { part: 1, parts: parts.length, frame: 0, frames: 1 } });
    try {
      const result = await exportProject(project, blobFor, (progress) => setPhase({ name: 'running', progress }), ctl.signal);
      setPhase({ name: 'done', result });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setPhase({ name: 'setup' });
      else setPhase({ name: 'error', message: e instanceof FriendlyError ? e.message : `Export failed. ${e instanceof Error ? e.message : ''}`.trim() });
    }
  };

  const close = () => {
    if (phase.name === 'running') return;
    onClose();
  };

  const setN = (patch: Partial<ExportSettings>) => setSettings(patch);

  return (
    <Sheet title={phase.name === 'done' ? 'Your videos' : 'Export'} onClose={close}>
      {phase.name === 'setup' && (
        <>
          <section>
            <h3>File name</h3>
            <input class="name-field" value={project.name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} aria-label="File name" maxLength={60} autocomplete="off" />
          </section>
          <section>
            <h3>Split into files</h3>
            <div class="chips">
              {SPLITS.map((o) => (
                <button key={o.label} class={`chip num ${!custom && s.splitSeconds === o.value ? 'on' : ''}`} onClick={() => (setCustom(false), setN({ splitSeconds: o.value }))}>
                  {o.label}
                </button>
              ))}
              <button class={`chip ${custom || isCustomValue ? 'on' : ''}`} onClick={() => (setCustom(true), setN({ splitSeconds: s.splitSeconds ?? 45 }))}>
                Custom
              </button>
            </div>
            {(custom || isCustomValue) && (
              <label class="field">
                Seconds per file
                <input
                  class="num"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={3600}
                  value={s.splitSeconds ?? 45}
                  onInput={(e) => {
                    const v = Number((e.currentTarget as HTMLInputElement).value);
                    if (v >= 1) setN({ splitSeconds: Math.min(3600, Math.round(v)) });
                  }}
                />
              </label>
            )}
            {s.splitSeconds !== null && (
              <label class="check">
                <input type="checkbox" checked={s.equalParts} onChange={(e) => setN({ equalParts: (e.currentTarget as HTMLInputElement).checked })} />
                Make all files the same length
              </label>
            )}
            <PartsBar parts={parts} total={total} />
          </section>

          <section>
            <h3>Resolution</h3>
            <Chips<ExportSettings['resolution']>
              label="Resolution"
              value={s.resolution}
              onPick={(v) => setN({ resolution: v })}
              options={[
                { label: '1080p', value: 1080 },
                { label: '720p', value: 720 },
                { label: '480p', value: 480 },
              ]}
            />
          </section>

          <section>
            <h3>Frame rate</h3>
            <div class="chips" role="group" aria-label="Frame rate">
              {[24, 30, 60].map((n) => (
                <button key={n} class={`chip num ${!customFps && s.fps === n ? 'on' : ''}`} aria-pressed={!customFps && s.fps === n} onClick={() => (setCustomFps(false), setN({ fps: n }))}>
                  {n} fps
                </button>
              ))}
              <button class={`chip ${customFps ? 'on' : ''}`} aria-pressed={customFps} onClick={() => setCustomFps(true)}>
                Custom
              </button>
            </div>
            {customFps && (
              <div class="rate-slider">
                <div class="rate-now num">{s.fps} fps</div>
                <Slider label="Frame rate" value={s.fps} min={1} max={60} step={1} fineStep={1} valueText={`${s.fps} frames per second`} onChange={(v) => setN({ fps: Math.max(1, Math.min(60, Math.round(v))) })} />
              </div>
            )}
          </section>

          <section>
            <h3>Quality</h3>
            <div class="chips" role="group" aria-label="Video quality">
              {QUALITIES.map((q) => (
                <button key={q.value} class={`chip ${!showSlider && s.quality === q.value ? 'on' : ''}`} aria-pressed={!showSlider && s.quality === q.value} onClick={() => (setCustomRate(false), setN({ quality: q.value, bitrateMbps: null }))}>
                  {q.label}
                </button>
              ))}
              <button
                class={`chip ${showSlider ? 'on' : ''}`}
                aria-pressed={showSlider}
                onClick={() => {
                  setCustomRate(true);
                  if (s.bitrateMbps === null) setN({ bitrateMbps: nearestStop(vbps / 1e6) });
                }}
              >
                Custom
              </button>
            </div>
            {showSlider && s.bitrateMbps !== null && (
              <div class="rate-slider">
                <div class="rate-now num">{fmtMbps(s.bitrateMbps * 1e6)}</div>
                <Slider label="Video bitrate" value={s.bitrateMbps} min={RATE_STOPS[0]} max={RATE_STOPS[RATE_STOPS.length - 1]!} snaps={RATE_STOPS} snapAlways step={1} fineStep={0.1} valueText={`${s.bitrateMbps} megabits per second`} onChange={(v) => setN({ bitrateMbps: Math.round(v * 10) / 10 })} />
              </div>
            )}
            <p class="hint num">
              {size.w}×{size.h}, MP4{showSlider ? ` · ${fmtMbps(vbps)}` : ''}
              {longest > 0 && ` · up to about ${fmtBytes(estimateBytes(vbps, longest, withSound))}${parts.length > 1 ? ' per file' : ''}`}
            </p>
          </section>

          <button class="cta" onClick={run} disabled={parts.length === 0}>
            {parts.length > 1 ? `Export ${parts.length} files` : 'Export video'}
          </button>
        </>
      )}

      {phase.name === 'running' && (
        <div class="running">
          <p class="big num">
            {phase.progress.parts > 1 ? `File ${phase.progress.part} of ${phase.progress.parts}` : 'Rendering'} · {Math.min(100, Math.floor((phase.progress.frame / phase.progress.frames) * 100))}%
          </p>
          <div class="bar">
            <i style={{ width: `${(phase.progress.frame / phase.progress.frames) * 100}%` }} />
          </div>
          <p class="hint">The screen stays on while this runs. Please stay in this app: if you switch apps or lock the phone, the export waits until you come back. Everything stays on your device.</p>
          <button class="btn" onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        </div>
      )}

      {phase.name === 'error' && (
        <div class="running">
          <p class="big">Export stopped</p>
          <p class="hint">{phase.message}</p>
          <button class="btn" onClick={() => setPhase({ name: 'setup' })}>
            Back to settings
          </button>
        </div>
      )}

      {phase.name === 'done' && <Done result={phase.result} note={note} setNote={setNote} onBack={() => setPhase({ name: 'setup' })} />}
    </Sheet>
  );
}

function PartsBar({ parts, total }: { parts: ReturnType<typeof planParts>; total: number }) {
  if (parts.length === 0) return null;
  const first = parts[0]!.end - parts[0]!.start;
  const last = parts[parts.length - 1]!.end - parts[parts.length - 1]!.start;
  // only a real leftover piece is striped: when all parts are the same length there is nothing to point out
  const shorterLast = parts.length > 1 && last < first - 0.05;
  return (
    <div class="plan">
      <div class="plan-bar" aria-hidden="true">
        {parts.map((p, i) => (
          <i key={i} class={i === parts.length - 1 && shorterLast ? 'rem' : ''} style={{ flexGrow: p.end - p.start }} />
        ))}
      </div>
      <p class="num">
        {parts.length === 1 ? '1 file' : `${parts.length} files`} · {parts.length <= 4 ? parts.map((p) => fmtTime(p.end - p.start, 0)).join(' + ') : `${fmtTime(parts[0]!.end - parts[0]!.start, 0)} each, last ${fmtTime(parts[parts.length - 1]!.end - parts[parts.length - 1]!.start, 0)}`} · {fmtTime(total, 0)} total
      </p>
    </div>
  );
}

function Done({ result, note, setNote, onBack }: { result: ExportResult; note: string; setNote: (s: string) => void; onBack: () => void }) {
  const { parts, warnings } = result;
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [shared, setShared] = useState(0);
  const sharing = useRef(false);
  const mark = (name: string) => setSaved((o) => new Set(o).add(name));

  const shareAll = async () => {
    if (sharing.current) return; // a second tap while the share sheet is opening would send everything twice
    sharing.current = true;
    try {
      const r = await shareFiles(parts);
      if (r === 'shared') {
        setShared((n) => n + 1);
        setNote('');
      } else if (r === 'unsupported') {
        setNote('Sharing is not available here, so the files are being downloaded.');
        parts.forEach((p, i) =>
          setTimeout(() => {
            saveBlob(p.name, p.blob);
            mark(p.name);
          }, i * 500),
        );
      }
    } finally {
      setTimeout(() => (sharing.current = false), 800);
    }
  };
  return (
    <>
      <ul class="results">
        {parts.map((p) => (
          <li key={p.name} class={saved.has(p.name) ? 'saved' : ''}>
            <div>
              <b>{p.name}</b>
              <span class="num">
                {fmtTime(p.seconds, 1)} · {fmtBytes(p.blob.size)}
              </span>
            </div>
            <button
              class={`btn small ${saved.has(p.name) ? 'done' : ''}`}
              onClick={() => {
                saveBlob(p.name, p.blob);
                mark(p.name);
              }}
              aria-label={`Download ${p.name}`}
            >
              {saved.has(p.name) ? <Check /> : <Download />} {saved.has(p.name) ? 'Saved' : 'Save'}
            </button>
          </li>
        ))}
      </ul>
      {warnings.map((w) => (
        <p class="warn" key={w}>
          {w}
        </p>
      ))}
      {saved.size > 0 && <p class="hint">Saved files go to your Files or Downloads. To put them in your photo gallery, use the share button below and choose Save Video.</p>}
      {note && <p class="hint">{note}</p>}
      {shared > 0 && (
        <p class="ok" role="status">
          <Check /> Sent to the share sheet{shared > 1 ? ` (${shared} times)` : ''}. If you chose Save Video, {parts.length > 1 ? `all ${parts.length} are` : 'it is'} in your gallery now. Sharing again adds copies.
        </p>
      )}
      <button class={`cta ${shared > 0 ? 'again' : ''}`} onClick={shareAll}>
        {shared > 0 ? <Check /> : <Share />} {shared > 0 ? 'Shared. Share again' : parts.length > 1 ? `Share or save all ${parts.length}` : 'Share or save'}
      </button>
      <button class="btn" onClick={onBack}>
        Back to settings
      </button>
    </>
  );
}
