import type { ComponentChildren } from 'preact';

const I = ({ children, size = 22 }: { children: ComponentChildren; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const Play = () => (
  <I size={26}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
  </I>
);
export const Pause = () => (
  <I size={26}>
    <path d="M8 5v14M16 5v14" stroke-width="3.2" />
  </I>
);
export const Plus = () => (
  <I>
    <path d="M12 5v14M5 12h14" />
  </I>
);
export const Trim = () => (
  <I>
    <path d="M9 4H5v16h4M15 4h4v16h-4M12 9v6" />
  </I>
);
export const Speed = () => (
  <I>
    <path d="M4 17a8 8 0 1 1 16 0M12 17l4-5" />
  </I>
);
export const Rotate = () => (
  <I>
    <path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5" />
  </I>
);
export const RotateL = () => (
  <I>
    <path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5" />
  </I>
);
export const Crop = () => (
  <I>
    <path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" />
  </I>
);
export const Sound = () => (
  <I>
    <path d="M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
  </I>
);
export const Mute = () => (
  <I>
    <path d="M4 10v4h3l5 4V6L7 10zM16 9l5 6M21 9l-5 6" />
  </I>
);
export const Clips = () => (
  <I>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M8 6v12M16 6v12" />
  </I>
);
export const Split = () => (
  <I>
    <path d="M12 3v18M7 8l-4 4 4 4M17 8l4 4-4 4" />
  </I>
);
export const Trash = () => (
  <I>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </I>
);
export const Copy = () => (
  <I>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </I>
);
export const Left = () => (
  <I>
    <path d="M14 6l-6 6 6 6" />
  </I>
);
export const Right = () => (
  <I>
    <path d="M10 6l6 6-6 6" />
  </I>
);
export const Gear = () => (
  <I>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
  </I>
);
export const Share = () => (
  <I>
    <path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </I>
);
export const Download = () => (
  <I>
    <path d="M12 3v12M8 11l4 4 4-4M5 20h14" />
  </I>
);
export const Close = () => (
  <I>
    <path d="M6 6l12 12M18 6L6 18" />
  </I>
);
