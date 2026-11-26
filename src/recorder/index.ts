import { RecorderClock } from './clock';
import { WebCodecsEncoder } from './webcodec';
import { RecorderMuxer } from './muxer';
import { RecorderAudio } from './audio';
import * as Overlay from '@/utils/overlay';
import { Game } from '@/game';

export class GameRecorder {
  options = {
    fps: 60,
    width: 1920,
    height: 1080,
  };

  readonly game: Game;

  readonly clock = new RecorderClock();
  encoder!: WebCodecsEncoder;
  readonly muxer = new RecorderMuxer();
  audio!: RecorderAudio;

  constructor(game: Game) {
    this.game = game;
  }

  async start() {
    const {
      chart,
      renderer,
    } = this.game;
    if (!chart) return;

    this.clock.fps = this.options.fps;
    this.clock.length = chart.audio.duration * 1000;
    this.clock.frameCurrent = 0;

    this.resize();
    chart.reszie(renderer.size);

    Overlay.show();
    Overlay.setTitle('Recording...');
    Overlay.setSubtitle('Initializing WebCodecs...');

    this.encoder = new WebCodecsEncoder(
      this.options.width,
      this.options.height,
      this.options.fps,
    );

    this.audio = new RecorderAudio(this.game);

    try {
      await this.encoder.init();
      Overlay.setSubtitle('Rendering...');
      await this.record();
    } catch (e) {
      Overlay.setSubtitle(`Failed to initialize WebCodecs: ${(e as Error).toString()}`);
      console.error(e);
    }
  }

  resize() {
    const { game, options } = this;
    const { width, height } = options;

    game.renderer.resize(width, height, 1);
    if (game.chart) game.chart.reszie(game.renderer.size);
  }

  private async record() {
    const { game, clock, encoder } = this;
    const chart = game.chart!;
    const yieldEvery = Math.max(1, Math.floor(this.options.fps / 2));

    for (let frame = 0; frame < clock.framesTotal; frame++) {
      clock.frameCurrent = frame;

      const currentTime = clock.time;
      Overlay.setSubtitle(`Encoding frame ${frame + 1}/${clock.framesTotal}...`);

      chart.onChartTick(currentTime, chart.data.container!);
      chart.score.onScoreTick(currentTime, 1000 / clock.fps);
      chart.score.ui.updateUIProgress(currentTime / clock.length);

      game.renderer.renderer.render(game.renderer.stage);
      await encoder.encodeFrame(game.renderer.canvas, frame);

      if ((frame + 1) % yieldEvery === 0) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      } else {
        await Promise.resolve();
      }
    }

    Overlay.setSubtitle('Finalizing video...');
    const encoded = await encoder.finalize();

    Overlay.setSubtitle('Generating audio...');
    const audio = await this.audio.generate();

    Overlay.setSubtitle('Muxing video...');
    const muxed = await this.muxer.mux(encoded, audio);
    const url = URL.createObjectURL(new Blob([ muxed.buffer.buffer as ArrayBuffer ], { type: muxed.mimeType }));

    const dom = document.createElement('a');
    dom.href = url;
    dom.download = muxed.fileName;
    dom.click();

    setTimeout(() => URL.revokeObjectURL(url), 5000);
    Overlay.setSubtitle(`Finished encoding ${encoder.encodedFrames} frames with ${encoder.codecLabel}.`);
  }
}
