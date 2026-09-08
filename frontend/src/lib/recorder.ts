/**
 * Microphone capture for the composer.
 *
 * MediaRecorder hands back whatever container the browser prefers — WebM/Opus on
 * Chrome, MP4 on Safari — and OpenRouter's audio input takes only WAV or MP3. So the
 * clip is decoded and re-encoded here as 16 kHz mono PCM WAV, which every transcription
 * path accepts and which is small enough to post from a phone.
 */

const SAMPLE_RATE = 16_000;

export type Recorder = {
  /** Resolves with the finished WAV clip, or null if it held no audio. */
  stop: () => Promise<File | null>;
  /** Drops the clip and releases the microphone. */
  cancel: () => void;
};

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  const release = () => stream.getTracks().forEach((t) => t.stop());

  return {
    stop: () =>
      new Promise<File | null>((resolve, reject) => {
        recorder.onstop = () => {
          release();
          const blob = new Blob(chunks, { type: recorder.mimeType });
          if (blob.size === 0) {
            resolve(null);
            return;
          }
          toWav(blob).then(resolve, reject);
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = release;
      if (recorder.state !== "inactive") recorder.stop();
      else release();
    },
  };
}

/** Decode whatever the browser recorded, then write it back out as a WAV file. */
async function toWav(blob: Blob): Promise<File | null> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = downmix(decoded);
    const samples = resample(mono, decoded.sampleRate, SAMPLE_RATE);
    if (samples.length === 0) return null;
    return new File([encodeWav(samples)], `voice-note-${Date.now()}.wav`, {
      type: "audio/wav",
    });
  } finally {
    void ctx.close();
  }
}

/** Average the channels: speech carries no stereo information worth the bytes. */
function downmix(buffer: AudioBuffer): Float32Array {
  const first = buffer.getChannelData(0);
  if (buffer.numberOfChannels === 1) return first;
  const out = new Float32Array(first.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++)
      out[i] += channel[i] / buffer.numberOfChannels;
  }
  return out;
}

/** Linear resample. Speech at 16 kHz loses nothing a transcriber was going to use. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const at = i * ratio;
    const low = Math.floor(at);
    const high = Math.min(low + 1, input.length - 1);
    out[i] = input[low] + (input[high] - input[low]) * (at - low);
  }
  return out;
}

function encodeWav(samples: Float32Array): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // PCM, uncompressed
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(
      44 + i * 2,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
  }
  return bytes;
}
