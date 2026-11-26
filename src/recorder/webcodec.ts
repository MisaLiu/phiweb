const MICROSECONDS_PER_SECOND = 1_000_000;

type SupportedCodec = {
  codec: string,
  label: string,
  muxCodec: 'av1' | 'hevc',
};

type ResolvedCodec = {
  candidate: SupportedCodec,
  config: VideoEncoderConfig,
};

export type EncodedRecorderOutput = {
  codec: 'av1' | 'hevc',
  fps: number,
  packets: Array<{
    chunk: EncodedVideoChunk,
    metadata?: EncodedVideoChunkMetadata,
  }>,
};

const SUPPORTED_CODECS: SupportedCodec[] = [
  {
    codec: 'hev1.1.6.L120.90',
    label: 'HEVC',
    muxCodec: 'hevc',
  },
  {
    codec: 'hvc1.1.6.L120.90',
    label: 'HEVC',
    muxCodec: 'hevc',
  },
  {
    codec: 'av01.0.08M.08',
    label: 'AV1',
    muxCodec: 'av1',
  },
];

const estimateBitrate = (width: number, height: number, fps: number) => {
  const pixelsPerSecond = width * height * fps;
  return Math.max(4_000_000, Math.round(pixelsPerSecond * 0.12));
};

const buildConfigVariants = (candidate: SupportedCodec, width: number, height: number, fps: number, bitrate: number) => {
  const baseConfig: VideoEncoderConfig = {
    codec: candidate.codec,
    width,
    height,
    framerate: fps,
    bitrate,
    latencyMode: 'quality',
  };

  const annexBConfig = {
    ...(candidate.codec.startsWith('avc1') ? { avc: { format: 'annexb' as const } } : {}),
    ...((candidate.codec.startsWith('hev1') || candidate.codec.startsWith('hvc1')) ? { hevc: { format: 'annexb' as const } } : {}),
  };

  return [
    {
      ...baseConfig,
      hardwareAcceleration: 'prefer-hardware' as const,
      ...annexBConfig,
    },
    {
      ...baseConfig,
      hardwareAcceleration: 'prefer-software' as const,
      ...annexBConfig,
    },
    {
      ...baseConfig,
      ...annexBConfig,
    },
    baseConfig,
  ];
};

const tryConfig = async (config: VideoEncoderConfig) => {
  try {
    return await VideoEncoder.isConfigSupported(config);
  } catch {
    return { supported: false, config };
  }
};

const pickCodec = async (width: number, height: number, fps: number, bitrate: number): Promise<ResolvedCodec> => {
  for (const candidate of SUPPORTED_CODECS) {
    const configVariants = buildConfigVariants(candidate, width, height, fps, bitrate);

    for (const config of configVariants) {
      const support = await tryConfig(config);

      if (support.supported) {
        return {
          candidate,
          config: support.config!,
        };
      }
    }
  }

  throw new Error('This browser does not support AV1/HEVC encoding with WebCodecs');
};

export class WebCodecsEncoder {
  private readonly packets: EncodedRecorderOutput['packets'] = [];
  private readonly frameTimestamps = new Set<number>();
  private readonly width: number;
  private readonly height: number;
  private readonly fps: number;
  private readonly bitrate: number;
  private readonly keyFrameInterval: number;

  private encoder?: VideoEncoder;
  private codec?: SupportedCodec;
  private config?: VideoEncoderConfig;
  private encoderError: Error | null = null;
  private frameCount = 0;
  private frameDurationUs = 0;

  constructor(width: number, height: number, fps: number) {
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.bitrate = estimateBitrate(width, height, fps);
    this.keyFrameInterval = Math.max(1, fps);
  }

  async init() {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
      throw new Error('WebCodecs is not available in this browser');
    }

    const resolvedCodec = await pickCodec(this.width, this.height, this.fps, this.bitrate);
    this.codec = resolvedCodec.candidate;
    this.config = resolvedCodec.config;
    this.encoderError = null;
    this.frameDurationUs = Math.round(MICROSECONDS_PER_SECOND / this.fps);
    this.frameCount = 0;
    this.frameTimestamps.clear();
    this.packets.length = 0;

    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        this.packets.push({
          chunk: new EncodedVideoChunk({
            type: chunk.type,
            timestamp: chunk.timestamp,
            duration: chunk.duration ?? (void 0),
            data: (() => {
              const payload = new Uint8Array(chunk.byteLength);
              chunk.copyTo(payload);
              return payload;
            })(),
          }),
          metadata,
        });
      },
      error: (error) => {
        this.encoderError = error instanceof Error ? error : new Error(String(error));
      },
    });

    this.encoder.configure(this.config);

    if (this.encoderError) throw this.encoderError;
  }

  get codecLabel() {
    if (!this.codec || !this.config) return 'WebCodecs';

    const acceleration = this.config.hardwareAcceleration
      ? ` (${this.config.hardwareAcceleration})`
      : '';

    return `${this.codec.label}${acceleration}`;
  }

  get codecKind(): EncodedRecorderOutput['codec'] {
    if (!this.codec) throw new Error('Encoder is not initialized');
    return this.codec.muxCodec;
  }

  get encodedFrames() {
    return this.frameCount;
  }

  async encodeFrame(source: CanvasImageSource, frameIndex: number) {
    if (!this.encoder) throw new Error('Encoder is not initialized');
    if (this.encoderError) throw this.encoderError;

    const timestamp = frameIndex * this.frameDurationUs;
    if (this.frameTimestamps.has(timestamp)) {
      throw new Error(`Duplicate frame timestamp detected: ${timestamp}`);
    }

    this.frameTimestamps.add(timestamp);
    const frame = new VideoFrame(source, {
      timestamp,
      duration: this.frameDurationUs,
    });

    try {
      this.encoder.encode(frame, {
        keyFrame: frameIndex % this.keyFrameInterval === 0,
      });
      this.frameCount++;
    } finally {
      frame.close();
    }

    if (this.encoder.encodeQueueSize > 2) {
      await this.encoder.flush();
    }

    if (this.encoderError) throw this.encoderError;
  }

  async finalize(): Promise<EncodedRecorderOutput> {
    if (!this.encoder || !this.codec) throw new Error('Encoder is not initialized');
    if (this.encoderError) throw this.encoderError;

    await this.encoder.flush();
    if (this.encoderError) throw this.encoderError;
    this.encoder.close();

    return {
      codec: this.codecKind,
      fps: this.fps,
      packets: this.packets,
    };
  }
}
