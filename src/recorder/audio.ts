import { AudioCodec } from 'mediabunny';
import { Clip } from '@phifans/audio';
import { Game } from '@/game';
import { GameChartData } from '@/chart/data';
import { TGameSkinHitsounds } from '@/skins/types';

type SupportedCodec = {
  codec: string,
  bitrate: number,
  muxCodec: AudioCodec,
};

export type RecorderAudioResult = {
  buffer: AudioBuffer,
  sampleRate: number,
  numberOfChannels: number,
  supportedCodec: SupportedCodec,
};

const SUPPORTED_CODECS: SupportedCodec[] = [
  {
    codec: 'mp4a.40.2',
    bitrate: 320_000,
    muxCodec: 'aac',
  },
  {
    codec: 'mp4a.40.2',
    bitrate: 192_000,
    muxCodec: 'aac',
  },
  {
    codec: 'mp4a.40.2',
    bitrate: 160_000,
    muxCodec: 'aac',
  },
  {
    codec: 'opus',
    bitrate: 320_000,
    muxCodec: 'opus',
  },
  {
    codec: 'opus',
    bitrate: 192_000,
    muxCodec: 'opus',
  },
  {
    codec: 'opus',
    bitrate: 160_000,
    muxCodec: 'opus',
  },
];

const tryConfig = async (codecInfo: SupportedCodec, sampleRate: number) => {
  try {
    return (await AudioEncoder.isConfigSupported({
      codec: codecInfo.codec,
      numberOfChannels: 2,
      sampleRate,
      bitrate: codecInfo.bitrate,
    })).supported ?? false;
  } catch {
    return false;
  }
};

const pickCodec = async (sampleRate: number) => {
  for (const codec of SUPPORTED_CODECS) {
    const support = await tryConfig(codec, sampleRate);

    if (support) return codec;
  }

  throw new Error('This browser does not support AAC-LC audio encoding with WebCodecs');
};

export class RecorderAudio {
  private readonly chart: GameChartData;
  private readonly audio: Clip;
  private readonly hitsounds: TGameSkinHitsounds;

  readonly sampleRate;
  readonly audioContext;
  
  constructor(game: Game) {
    if (!game.chart)
      throw new Error('Cannot init RecorderAudio before chart initialized!');

    if (!game.skins.currentSkin)
      throw new Error('Cannot init RecorderAudio before skin initialized!');

    this.chart = game.chart.data;
    this.audio = game.chart.audio;
    this.hitsounds = game.skins.currentSkin.hitsounds;

    this.sampleRate = this.audio.source.sampleRate ?? 48000;
    const audioDuration = Math.ceil((this.audio.duration - this.chart.offset / 1000) * this.sampleRate);
    this.audioContext = new OfflineAudioContext(2, audioDuration, this.sampleRate);
  }

  async generate(): Promise<RecorderAudioResult> {
    const { audioContext } = this;

    const musicChannel = audioContext.createGain();
    musicChannel.connect(audioContext.destination);

    const musicNode = audioContext.createBufferSource();
    musicNode.buffer = this.audio.source;
    musicNode.connect(musicChannel);

    const chartOffset = -this.chart.offset / 1000;
    musicNode.start(Math.max(0, chartOffset), Math.min(0, chartOffset) * -1);

    const effectChannel = audioContext.createGain();
    effectChannel.gain.value = 0.75; // TODO: Made as an option
    effectChannel.connect(audioContext.destination);

    for (const note of this.chart.notes) {
      if (note.isFake) continue;

      const hitsoundBuffer = (
        note.type === 2 ? this.hitsounds.drag :
        note.type === 4 ? this.hitsounds.flick :
        this.hitsounds.tap
      );

      const hitsoundNode = audioContext.createBufferSource();
      hitsoundNode.buffer = hitsoundBuffer.source;
      hitsoundNode.connect(effectChannel);

      hitsoundNode.start(note.time / 1000);
    }

    return {
      buffer: await audioContext.startRendering(),
      sampleRate: this.sampleRate,
      numberOfChannels: 2,
      supportedCodec: await pickCodec(this.sampleRate),
    };
  }
}
