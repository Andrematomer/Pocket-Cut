import { useRef, useState } from 'preact/hooks';
import { FriendlyError, exportProject, type ExportProgress, type ExportResult } from '../exporter.ts';
import { engine } from '../engine.ts';
import { fmtBytes, saveBlob, shareFiles } from '../files.ts';
import { outputSize } from '../geometry.ts';
import { blobFor, setSettings, useStore } from '../store.ts';
import { fmtTime, layout, planParts } from '../timeline.ts';
import type { AspectChoice, ExportSettings } from '../types.ts';
import { Download, Share } from './icons.tsx';
import { Sheet } from './Sheet.tsx';

const SPLITS: { label: string; value: number | null }[] = [
  { label: 'Off', value: null },
  { label: '15 s', value: 15 },
  { label: '30 s', value: 30 },
  { label: '60 s', value: 60 },
];

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
  const abort = useRef<AbortController | null>(null);
  const [note, setNote] = useState('');

  const s = project.settings;
  const total = layout(project.clips).total;
  const parts = planParts(total, s.splitSeconds, s.equalParts, s.fps);
  const size = outputSize(project);
  const isCustomValue = s.splitSeconds !== null && !SPLITS.some((x) => x.value === s.splitSeconds);

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
            <h3>Picture</h3>
            <Chips<AspectChoice>
              label="Shape"
              value={s.aspect}
              onPick={(v) => setN({ aspect: v })}
              options={[
                { label: 'Auto', value: 'auto' },
                { label: '9:16', value: '9:16' },
                { label: '4:5', value: '4:5' },
                { label: '1:1', value: '1:1' },
                { label: '16:9', value: '16:9' },
              ]}
            />
            <Chips<ExportSettings['fit']>
              label="Fit"
              value={s.fit}
              onPick={(v) => setN({ fit: v })}
              options={[
                { label: 'Fit (bars)', value: 'contain' },
                { label: 'Fill (trim edges)', value: 'cover' },
              ]}
            />
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
            <Chips<ExportSettings['fps']> label="Frame rate" value={s.fps} onPick={(v) => setN({ fps: v })} options={[{ label: '24 fps', value: 24 }, { label: '30 fps', value: 30 }, { label: '60 fps', value: 60 }]} />
            <Chips<ExportSettings['quality']> label="Quality" value={s.quality} onPick={(v) => setN({ quality: v })} options={[{ label: 'Small file', value: 'small' }, { label: 'Balanced', value: 'medium' }, { label: 'Best', value: 'high' }]} />
            <p class="hint num">
              {size.w}×{size.h}, MP4
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
          <p class="hint">Keep this screen open until it finishes. Everything stays on your device.</p>
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
  return (
    <div class="plan">
      <div class="plan-bar" aria-hidden="true">
        {parts.map((p, i) => (
          <i key={i} style={{ flexGrow: p.end - p.start }} />
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
  const shareAll = async () => {
    const r = await shareFiles(parts);
    if (r === 'unsupported') {
      setNote('Sharing is not available here, so the files are being downloaded.');
      parts.forEach((p, i) => setTimeout(() => saveBlob(p.name, p.blob), i * 500));
    }
  };
  return (
    <>
      <ul class="results">
        {parts.map((p) => (
          <li key={p.name}>
            <div>
              <b>{p.name}</b>
              <span class="num">
                {fmtTime(p.seconds, 1)} · {fmtBytes(p.blob.size)}
              </span>
            </div>
            <button class="btn small" onClick={() => saveBlob(p.name, p.blob)} aria-label={`Download ${p.name}`}>
              <Download /> Save
            </button>
          </li>
        ))}
      </ul>
      {warnings.map((w) => (
        <p class="warn" key={w}>
          {w}
        </p>
      ))}
      {note && <p class="hint">{note}</p>}
      <button class="cta" onClick={shareAll}>
        <Share /> {parts.length > 1 ? `Share or save all ${parts.length}` : 'Share or save'}
      </button>
      <button class="btn" onClick={onBack}>
        Back to settings
      </button>
    </>
  );
}
