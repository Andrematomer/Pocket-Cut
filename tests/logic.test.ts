import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_VIEW, baseScale, clampView, snapEightCropped, dragView, fillZoom, fitZoom, frameTransform, nearestAspect, snapEight, normAngle, outputSize, pinchView, quarterTurned, snapView } from '../src/geometry.ts';
import { gradePixel } from '../src/layers.ts';
import { activeAt, endOfTrack, freeTrack, gapAt, removeGap, planParts, sourceAt, totalOf } from '../src/timeline.ts';
import { resample, timeStretch } from '../src/stretch.ts';
import { MAX_MBPS, MIN_MBPS, RATE_STOPS, autoBitrate, estimateBytes, fmtMbps, videoBitrate } from '../src/bitrate.ts';
import { emptyProject, type Clip } from '../src/types.ts';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

const view = (o: Partial<typeof IDENTITY_VIEW> = {}) => ({ ...IDENTITY_VIEW, ...o });

test('default view: the whole picture fits and sits in the middle', () => {
  const t = frameTransform(1920, 1080, { outW: 1080, outH: 1920, view: view() });
  close(t.tx, 540);
  close(t.ty, 960);
  close(t.scale, 1080 / 1920);
  close(baseScale(1920, 1080, 1080, 1920), 0.5625);
});

test('fit and fill zoom: bars versus trimmed edges, also when turned', () => {
  // 16:9 picture on a 9:16 canvas
  close(fitZoom(1920, 1080, 0, 1080, 1920), 1);
  close(fillZoom(1920, 1080, 0, 1080, 1920), 1920 / 1080 / (1080 / 1920), 1e-9);
  // turned a quarter, the same picture fills a portrait canvas exactly
  close(fitZoom(1920, 1080, 90, 1080, 1920), fillZoom(1920, 1080, 90, 1080, 1920));
  assert.ok(fitZoom(1920, 1080, 90, 1080, 1920) > 1);
});

test('dragView moves by canvas fractions', () => {
  const v = dragView(view(), 200, 400, 20, -40);
  close(v.x, 0.1);
  close(v.y, -0.1);
});

test('pinchView: pinch zooms, twist turns, both about the point between the fingers', () => {
  // fingers 100 apart horizontally, then 200 apart: zoom doubles, centre stays
  const a0 = { x: -50, y: 0 };
  const b0 = { x: 50, y: 0 };
  const z = pinchView(view(), 400, 400, a0, b0, { x: -100, y: 0 }, { x: 100, y: 0 });
  close(z.zoom, 2);
  close(z.x, 0);
  close(z.rot, 0);
  // twist a quarter turn clockwise (screen y points down)
  const t = pinchView(view(), 400, 400, a0, b0, { x: 0, y: -50 }, { x: 0, y: 50 });
  close(normAngle(t.rot), 90);
  close(t.zoom, 1);
  // a picture off to the right swings round the fingers' midpoint
  const off = pinchView(view({ x: 0.25 }), 400, 400, a0, b0, { x: 0, y: -50 }, { x: 0, y: 50 });
  close(off.x * 400, 0, 1e-6);
  close(off.y * 400, 100, 1e-6);
});

test('snapView: centre, quarter turns, fit and fill pull in; far values are left alone', () => {
  const env = { sw: 1920, sh: 1080, W: 360, H: 640 };
  const s = snapView(view({ x: 0.01, y: -0.008, rot: 87, zoom: fitZoom(1920, 1080, 90, 360, 640) * 1.01 }), env);
  assert.equal(s.view.x, 0);
  assert.equal(s.view.y, 0);
  assert.equal(s.view.rot, 90);
  assert.equal(s.zoom, 'fit');
  close(s.view.zoom, fitZoom(1920, 1080, 90, 360, 640));
  const far = snapView(view({ x: 0.2, y: 0.2, rot: 40, zoom: 3 }), env);
  assert.equal(far.view.x, 0.2);
  assert.equal(far.view.rot, 40);
  assert.equal(far.view.zoom, 3);
  assert.equal(far.rot, null);
  const fill = snapView(view({ zoom: fillZoom(1920, 1080, 0, 360, 640) * 0.99 }), env);
  assert.equal(fill.zoom, 'fill');
});

test('normAngle and quarterTurned', () => {
  close(normAngle(270), -90);
  close(normAngle(-181), 179);
  assert.deepEqual(quarterTurned(10, 20, 90), { w: 20, h: 10 });
  assert.deepEqual(quarterTurned(10, 20, -90), { w: 20, h: 10 });
  assert.deepEqual(quarterTurned(10, 20, 180), { w: 10, h: 20 });
  assert.deepEqual(quarterTurned(10, 20, 30), { w: 10, h: 20 });
});

test('outputSize: presets are even-sized', () => {
  const p = emptyProject();
  p.settings.resolution = 1080;
  p.settings.aspect = '4:5';
  assert.deepEqual(outputSize(p), { w: 1080, h: 1350 });
  p.settings.aspect = '16:9';
  assert.deepEqual(outputSize(p), { w: 1920, h: 1080 });
  p.settings.resolution = 720;
  p.settings.aspect = '9:16';
  assert.deepEqual(outputSize(p), { w: 720, h: 1280 });
});

test('nearestAspect: picks the canvas that suits the first picture', () => {
  assert.equal(nearestAspect(1080, 1920), '9:16');
  assert.equal(nearestAspect(1920, 1080), '16:9');
  assert.equal(nearestAspect(1000, 1000), '1:1');
  assert.equal(nearestAspect(1080, 1350), '4:5');
});

test('timeline: clips sit at their own start, lanes stack, speed changes length', () => {
  const mk = (id: string, start: number, end: number, speed: number, at: number, track: number): Clip => ({ id, mediaId: 'a', start, end, speed, view: IDENTITY_VIEW, volume: 1, keepPitch: true, at, track });
  const clips = [mk('1', 0, 10, 2, 0, 0), mk('2', 5, 8, 1, 5, 0), mk('3', 0, 4, 1, 3, 1), mk('4', 0, 4, 1, 20, -1)];
  close(totalOf(clips), 24);
  assert.deepEqual(activeAt(clips, 4), [0, 2]); // lane 0 below lane 1
  assert.deepEqual(activeAt(clips, 6), [1, 2]);
  assert.deepEqual(activeAt(clips, 10), []); // a gap
  assert.deepEqual(activeAt(clips, 21), [3]);
  close(endOfTrack(clips, 0), 8);
  close(endOfTrack(clips, 7), 0);
  close(sourceAt(clips[0]!, 2), 4); // 2 s in at double speed = 4 s into the source
  assert.ok(sourceAt(clips[0]!, 99) < 10); // never past the trim
});

test('planParts: fixed length, remainder last', () => {
  const p = planParts(150, 60, false, 30);
  assert.equal(p.length, 3);
  assert.deepEqual(p.map((x) => x.end - x.start), [60, 60, 30]);
  assert.equal(p[0]!.endFrame, p[1]!.startFrame); // no frame lost or doubled at the seams
  assert.equal(p[2]!.endFrame, 150 * 30);
});

test('planParts: equal parts all stay under the limit', () => {
  const p = planParts(130, 60, true, 30);
  assert.equal(p.length, 3);
  for (const x of p) assert.ok(x.end - x.start <= 60 + 1e-9);
  close(p[0]!.end - p[0]!.start, 130 / 3, 0.04);
  assert.equal(p[2]!.endFrame, 130 * 30);
});

test('planParts: short video is one file, exact multiple has no empty tail, off = one file', () => {
  assert.equal(planParts(45, 60, false, 30).length, 1);
  assert.equal(planParts(120, 60, false, 30).length, 2);
  assert.equal(planParts(120.0000001, 60, false, 30).length, 2);
  assert.equal(planParts(500, null, false, 30).length, 1);
  assert.equal(planParts(0, 60, false, 30).length, 0);
});

/** frequency estimate from upward zero crossings */
function freq(x: Float32Array, rate: number): number {
  let z = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1]! < 0 && x[i]! >= 0) z++;
  return z / (x.length / rate);
}

const sine = (f: number, rate: number, secs: number) => {
  const a = new Float32Array(Math.round(rate * secs));
  for (let i = 0; i < a.length; i++) a[i] = 0.6 * Math.sin((2 * Math.PI * f * i) / rate);
  return a;
};

test('timeStretch keeps pitch and scales length (2x faster, 0.5x slower)', () => {
  const rate = 48000;
  const input = [sine(440, rate, 3), sine(440, rate, 3)];
  for (const speed of [2, 0.5, 1.5, 4]) {
    const out = timeStretch(input, rate, speed);
    close(out[0]!.length / rate, 3 / speed, 0.01);
    const body = out[0]!.subarray(Math.round(rate * 0.1), out[0]!.length - Math.round(rate * 0.1));
    const f = freq(body, rate);
    assert.ok(Math.abs(f - 440) < 12, `speed ${speed}: ${f} Hz`);
    // no big holes: every 50 ms window carries energy
    const win = rate * 0.05;
    for (let i = rate * 0.1; i + win < out[0]!.length - rate * 0.1; i += win) {
      let e = 0;
      for (let j = 0; j < win; j++) e += out[0]![i + j]! ** 2;
      assert.ok(Math.sqrt(e / win) > 0.25, `speed ${speed}: dip at ${i / rate}s`);
    }
  }
});

test('timeStretch is a no-op at speed 1', () => {
  const input = [sine(300, 48000, 0.5)];
  assert.equal(timeStretch(input, 48000, 1), input);
});

test('bitrate: a target overrides the quality preset, is clamped, and null falls back to auto', () => {
  const base = { quality: 'medium' as const, fps: 30 as const };
  assert.equal(videoBitrate({ ...base, bitrateMbps: 4 }, 1080, 1920), 4_000_000);
  assert.equal(videoBitrate({ ...base, bitrateMbps: 2.5 }, 480, 854), 2_500_000);
  assert.equal(videoBitrate({ ...base, bitrateMbps: 9999 }, 1080, 1920), MAX_MBPS * 1_000_000);
  assert.equal(videoBitrate({ ...base, bitrateMbps: 0.01 }, 1080, 1920), MIN_MBPS * 1_000_000);
  assert.equal(videoBitrate({ ...base, bitrateMbps: null }, 1080, 1920), autoBitrate(1080, 1920, 30, 'medium'));
  assert.ok(autoBitrate(1080, 1920, 30, 'high') > autoBitrate(1080, 1920, 30, 'small'));
  assert.ok(autoBitrate(64, 64, 30, 'small') >= 800_000);
});

test('bitrate: size estimate and label', () => {
  // 4 Mbps video + 128 kbps audio for 60 s
  assert.equal(estimateBytes(4_000_000, 60, true), Math.round((4_128_000 * 60) / 8));
  assert.equal(estimateBytes(4_000_000, 60, false), 30_000_000);
  assert.equal(fmtMbps(4_000_000), '4 Mbps');
  assert.equal(fmtMbps(2_500_000), '2.5 Mbps');
  assert.equal(fmtMbps(12_000_000), '12 Mbps');
});

test('resample: pitch follows speed, length scales, speed 1 is a no-op', () => {
  const rate = 48000;
  const input = [sine(440, rate, 2)];
  const out = resample(input, 2);
  close(out[0]!.length / rate, 1, 0.01);
  const f = freq(out[0]!, rate);
  assert.ok(Math.abs(f - 880) < 20, `${f} Hz`);
  assert.equal(resample(input, 1), input);
});

test('bitrate slider stops start at 1 Mbps, rise, and are inside the limits', () => {
  assert.equal(RATE_STOPS[0], 1);
  assert.equal(MIN_MBPS, 1);
  for (let i = 1; i < RATE_STOPS.length; i++) assert.ok(RATE_STOPS[i]! > RATE_STOPS[i - 1]!);
  assert.ok(RATE_STOPS[RATE_STOPS.length - 1]! <= MAX_MBPS);
});

test('split is off by default', () => {
  assert.equal(emptyProject().settings.splitSeconds, null);
});

test('snapEight: goes to the closest of the eight tidy placements, and flips fit/fill when already there', () => {
  const W = 360, H = 640;
  // a 16:9 picture turned about 78° and made small: becomes the quarter turn at 90° that fits
  const v = snapEight({ x: 0.02, y: 0, zoom: 0.3, rot: 78 }, 1920, 1080, W, H);
  assert.equal(v.rot, 90);
  assert.ok(Math.abs(v.zoom - fitZoom(1920, 1080, 90, W, H)) < 1e-9);
  assert.deepEqual([v.x, v.y], [0, 0]);
  // tapping again on a tidy placement switches to the other zoom
  const w = snapEight(v, 1920, 1080, W, H);
  assert.ok(Math.abs(w.zoom - fillZoom(1920, 1080, 90, W, H)) < 1e-9);
  // 5:4 exists
  assert.equal(nearestAspect(1280, 1024), '5:4');
});

test('snapView: sides of the picture catch on the sides of the frame', () => {
  const env = { sw: 1000, sh: 1000, W: 360, H: 640 };
  // zoom 0.5 of "fits": a 180 px square (width of the frame / 2); its left side 3 px off the frame's left side
  const z = 0.5;
  const half = (1000 * (Math.min(360 / 1000, 640 / 1000) * z)) / 2;
  const x = (half - 180 + 3) / 360;
  const s = snapView({ x, y: 0.3, zoom: z, rot: 0 }, env);
  assert.ok(s.edge);
  assert.ok(Math.abs(s.view.x * 360 - (half - 180)) < 1e-9);
});

const mk = (id: string, at: number, dur: number, track: number): Clip => ({ id, mediaId: 'm', start: 0, end: dur, speed: 1, view: view(), volume: 1, keepPitch: true, at, track });

test('gapAt: finds the empty stretch between two clips of a lane, not on a clip or after the last', () => {
  const cs = [mk('a', 0, 2, 0), mk('b', 5, 2, 0)];
  assert.deepEqual(gapAt(cs, 0, 3), { track: 0, from: 2, to: 5 });
  assert.equal(gapAt(cs, 0, 1), null);
  assert.equal(gapAt(cs, 0, 8), null);
  assert.deepEqual(gapAt([mk('c', 4, 1, 0)], 0, 1), { track: 0, from: 0, to: 4 });
});

test('removeGap: later clips move earlier on every lane, collisions hop to the next free lane', () => {
  // lane 0 has a 3 s gap (2..5). Lane 1: x (2..6) straddles the gap and stays, y (6..9) would land on 3..6 on top of x
  const cs = [mk('a', 0, 2, 0), mk('b', 5, 2, 0), mk('x', 2, 4, 1), mk('y', 6, 3, 1)];
  const out = removeGap(cs, { track: 0, from: 2, to: 5 });
  const by = (id: string) => out.find((c) => c.id === id)!;
  assert.equal(by('b').at, 2);
  assert.equal(by('b').track, 0);
  assert.equal(by('y').at, 3);
  assert.equal(by('y').track, 2);
  assert.equal(by('x').at, 2);
  assert.equal(by('x').track, 1);
  // sound lanes hop downwards
  const au = [mk('v', 3, 1, 0), mk('p', 1, 4, -1), mk('q', 5, 1, -1)];
  const o2 = removeGap(au, { track: 0, from: 0, to: 3 });
  assert.equal(o2.find((c) => c.id === 'q')!.at, 2);
  assert.equal(o2.find((c) => c.id === 'q')!.track, -2);
  assert.equal(o2.find((c) => c.id === 'p')!.at, 1);
});

test('clampView: up to 90% of the picture may leave the frame', () => {
  const env = { sw: 1000, sh: 1000, W: 360, H: 640 };
  const v = clampView({ x: 5, y: 0, zoom: 1, rot: 0 }, env);
  const half = 360 / 2; // the picture is 360 wide at zoom 1
  // its center may sit W/2 + 0.8 * half away: 10% of its width stays in
  close(v.x * 360, 180 + 0.8 * half);
  // without an env the center stays on the canvas
  close(clampView({ x: 5, y: 0, zoom: 1, rot: 0 }).x, 0.5);
});

test('gradePixel: zero grade is the identity, brightness and saturation behave', () => {
  const g0 = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
  const px: [number, number, number] = [0.2, 0.5, 0.8];
  gradePixel(px, g0).forEach((v, i) => close(v, px[i]!, 1e-9));
  assert.deepEqual(gradePixel([0.5, 0.5, 0.5], { ...g0, saturation: -1 }).map((v) => +v.toFixed(6)), [0.5, 0.5, 0.5]);
  const gray = gradePixel([1, 0, 0], { ...g0, saturation: -1 });
  close(gray[0], gray[1]);
  assert.ok(gradePixel([0.5, 0.5, 0.5], { ...g0, brightness: 0.4 })[0] > 0.6);
  assert.ok(gradePixel([0.5, 0.5, 0.5], { ...g0, warmth: 0.5 })[0] > gradePixel([0.5, 0.5, 0.5], { ...g0, warmth: 0.5 })[2]);
});

test('freeTrack: a clip dropped on another one goes to the next free lane, away from 0', () => {
  const others = [mk('a', 0, 4, 0), mk('b', 0, 4, 1), mk('c', 0, 4, -1)];
  assert.equal(freeTrack(others, 1, 2, 0), 2);
  assert.equal(freeTrack(others, 4, 2, 0), 0); // touching is not overlapping
  assert.equal(freeTrack(others, 1, 2, -1), -2);
  assert.equal(freeTrack(others, 1, 2, 5), 5);
});

test('snapEightCropped: fits the part left after a crop and centers it', () => {
  const W = 360, H = 640;
  const crop = { l: 0.5, t: 0, r: 0, b: 0 }; // the right half of a 1000x1000 picture stays
  const v = snapEightCropped({ x: 0, y: 0, zoom: 1, rot: 0 }, crop, 1000, 1000, W, H);
  // the kept half is 500 x 1000: it fits when its height is 640 -> scale .64, or its width 500*s <= 360
  const sc = baseScale(1000, 1000, W, H) * v.zoom;
  assert.ok(Math.abs(500 * sc - 360) < 1e-6 || Math.abs(1000 * sc - 640) < 1e-6);
  // the middle of the kept half (a quarter of the width right of the picture's middle) is on the canvas middle
  close(v.x * W + 250 * sc, 0, 1e-6);
  assert.equal(snapEightCropped({ x: 0, y: 0, zoom: 1, rot: 0 }, undefined, 1000, 1000, W, H).x, snapEight({ x: 0, y: 0, zoom: 1, rot: 0 }, 1000, 1000, W, H).x);
});
