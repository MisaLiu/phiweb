import {
  AudioBufferSource,
  AudioCodec,
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import type { EncodedRecorderOutput } from './webcodec';
import type { RecorderAudioResult } from './audio';

type MuxResult = {
  buffer: Uint8Array,
  fileName: string,
  mimeType: string,
};

const createOutput = (
  codec: EncodedRecorderOutput['codec'],
  fps: number,
  audioCodec: AudioCodec,
  audioBitrate: number,
) => {
  const target = new BufferTarget();
  const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
  const source = new EncodedVideoPacketSource(codec);
  const audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: audioBitrate });
  const output = new Output({
    format,
    target,
  });

  output.addVideoTrack(source, {
    frameRate: fps,
  });

  output.addAudioTrack(audioSource);

  return {
    output,
    source,
    audioSource,
    target,
    fileName: 'output.mp4',
    mimeType: format.mimeType,
  };
};

export class RecorderMuxer {
  async mux(payload: EncodedRecorderOutput, audio: RecorderAudioResult): Promise<MuxResult> {
    const { output, source, audioSource, target, fileName, mimeType } = createOutput(
      payload.codec,
      payload.fps,
      audio.supportedCodec.muxCodec,
      audio.supportedCodec.bitrate,
    );

    await output.start();

    for (const { chunk, metadata } of payload.packets) {
      const packet = EncodedPacket.fromEncodedChunk(chunk);
      await source.add(packet, metadata);
    }
    await audioSource.add(audio.buffer);

    source.close();
    audioSource.close();
    await output.finalize();

    if (!target.buffer) {
      throw new Error('Mediabunny did not produce an output buffer');
    }

    return {
      buffer: new Uint8Array(target.buffer),
      fileName,
      mimeType,
    };
  }
}
