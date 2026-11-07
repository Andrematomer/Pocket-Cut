import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';

/** loudness outline: this many peaks per second of sound */
export const PEAKS_PER_SEC = 20;

/**
 * The outline of a sound file for the timeline: the loudest sample in every 50 ms, 0..255. The file is
 * decoded in a stream (a little at a time, never all in memory), so a long song costs a second or two in
 * the background and almost no memory.
 */
export async function computePeaks(blob: Blob): Promise<Uint8Array | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const dur = await track.computeDuration();
    const out = new Uint8Array(Math.max(1, Math.ceil(dur * PEAKS_PER_SEC) + 1));
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      const rate = buffer.sampleRate;
      const n = buffer.length;
      const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
      const step = Math.max(1, Math.floor(rate / 2000)); // 2000 looks per second are plenty for a 20 per second outline
      for (let i = 0; i < n; i += step) {
        let v = 0;
        for (const ch of chans) v = Math.max(v, Math.abs(ch[i]!));
        const bin = Math.floor((timestamp + i / rate) * PEAKS_PER_SEC);
        const q = Math.min(255, Math.round(Math.sqrt(Math.min(1, v)) * 255));
        if (bin >= 0 && bin < out.length && q > out[bin]!) out[bin] = q;
      }
    }
    return out;
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}
