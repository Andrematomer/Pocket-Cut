import { useEffect, useState } from 'preact/hooks';
import { fmtBytes } from '../files.ts';
import { storageEstimate } from '../persist.ts';
import { discardProject, useStore } from '../store.ts';
import { Sheet } from './Sheet.tsx';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
}
let installEvent: InstallEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e as InstallEvent;
});

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const hasProject = useStore((s) => s.project.clips.length > 0);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const offline = !!navigator.serviceWorker?.controller;

  useEffect(() => {
    void storageEstimate().then(setUsage);
  }, []);

  return (
    <Sheet title="About & storage" onClose={onClose}>
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
        <h3>Offline</h3>
        <p class="hint">{offline ? 'Ready to work without a connection.' : 'Open the app once while online. After that it works offline.'}</p>
        {!standalone && installEvent && (
          <button class="btn" onClick={() => void installEvent?.prompt()}>
            Install app
          </button>
        )}
        {!standalone && isIOS && <p class="hint">To install on iPhone or iPad: tap Share, then Add to Home Screen.</p>}
      </section>
    </Sheet>
  );
}
