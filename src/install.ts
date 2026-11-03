/** Is the app running installed (from the home screen) or in a browser tab? */
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/.test(navigator.userAgent);
export const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
/** phones and tablets, where installing makes sense (on a computer the browser tab is fine) */
export const isMobile = isIOS || isAndroid;

interface InstallEvent extends Event {
  prompt(): Promise<void>;
}
let installEvent: InstallEvent | null = null;
const listeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e as InstallEvent;
  listeners.forEach((f) => f());
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  listeners.forEach((f) => f());
});
export const canPromptInstall = (): boolean => installEvent !== null;
export const promptInstall = (): Promise<void> => installEvent?.prompt() ?? Promise.resolve();
export const onInstallChange = (f: () => void): (() => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};
