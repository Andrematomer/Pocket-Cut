/** How a clip sits on the canvas. x/y: picture center offset in canvas widths/heights, zoom 1 = whole picture fits, rot in degrees. */
export interface View {
  x: number;
  y: number;
  zoom: number;
  rot: number;
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
  /** missing = video */
  kind?: 'video' | 'image' | 'audio';
  /** set when the picture is a piece of text made in the app */
  text?: string;
  textColor?: string;
  textFont?: string;
  /** outline around the text: color and thickness (0 = none) */
  textOutline?: string;
  textWidth?: number;
  /** set when the picture is a plain color (an "empty" clip) */
  solid?: string;
}

export interface Grade {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
}

export interface Crop {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface Clip {
  id: string;
  mediaId: string;
  /** trim in/out, seconds in the source file */
  start: number;
  end: number;
  /** playback speed, 1 = normal */
  speed: number;
  view: View;
  /** 0..1, 0 = muted */
  volume: number;
  keepPitch: boolean;
  /** when the clip starts on the timeline, seconds */
  at: number;
  /** 0..1, how see-through the clip is (missing = 1) */
  opacity?: number;
  /** color grading, each -1..1 with 0 = unchanged */
  grade?: Grade;
  /** the part of each side that is cut off, 0..1 of the picture's size */
  crop?: Crop;
  /** lane: higher lanes are drawn on top; audio clips live on lane -1 and below */
  track: number;
}

export type AspectChoice = '9:16' | '4:5' | '1:1' | '5:4' | '16:9';

export interface ExportSettings {
  aspect: AspectChoice;
  /** length of the shorter output side in pixels */
  resolution: 480 | 720 | 1080;
  fps: 24 | 30 | 60;
  quality: 'small' | 'medium' | 'high';
  /** target video bitrate in Mbps; null = pick from the quality preset */
  bitrateMbps: number | null;
  /** max seconds per output file, null = one single file */
  splitSeconds: number | null;
  /** true: make all parts the same length (all <= splitSeconds) */
  equalParts: boolean;
  /** canvas color behind all layers */
  background: string;
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
  aspect: '9:16',
  resolution: 1080,
  fps: 30,
  quality: 'medium',
  bitrateMbps: null,
  splitSeconds: null,
  equalParts: false,
  background: '#000000',
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
