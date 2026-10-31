export type Rotation = 0 | 90 | 180 | 270;

/** Normalized rectangle (0..1) inside the *rotated* frame of a clip. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MediaInfo {
  id: string;
  name: string;
  /** seconds */
  duration: number;
  /** display size in pixels (after the file's own rotation metadata) */
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface Clip {
  id: string;
  mediaId: string;
  /** trim in/out, seconds in the source file */
  start: number;
  end: number;
  /** playback speed, 1 = normal */
  speed: number;
  rotation: Rotation;
  /** null = whole frame */
  crop: Crop | null;
  /** aspect (w/h) the crop is locked to, null = free */
  cropAspect: number | null;
  muted: boolean;
}

export type AspectChoice = 'auto' | '9:16' | '4:5' | '1:1' | '16:9';

export interface ExportSettings {
  aspect: AspectChoice;
  /** how a clip is placed when its shape differs from the output shape */
  fit: 'contain' | 'cover';
  /** length of the shorter output side in pixels */
  resolution: 480 | 720 | 1080;
  fps: 24 | 30 | 60;
  quality: 'small' | 'medium' | 'high';
  /** max seconds per output file, null = one single file */
  splitSeconds: number | null;
  /** true: make all parts the same length (all <= splitSeconds) */
  equalParts: boolean;
}

export interface Project {
  version: 1;
  name: string;
  clips: Clip[];
  media: Record<string, MediaInfo>;
  settings: ExportSettings;
  updated: number;
}

export const DEFAULT_SETTINGS: ExportSettings = {
  aspect: 'auto',
  fit: 'contain',
  resolution: 1080,
  fps: 30,
  quality: 'medium',
  splitSeconds: 60,
  equalParts: false,
};

export function emptyProject(): Project {
  return {
    version: 1,
    name: 'My video',
    clips: [],
    media: {},
    settings: { ...DEFAULT_SETTINGS },
    updated: Date.now(),
  };
}
