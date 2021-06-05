import { Transform, TransformCallback } from 'stream';

// Ingests all of the logs from events and containers, to determine when to
// trigger additional crawls.
export default class LogMonitor extends Transform {
  first: boolean;
  constructor() {
    super({ objectMode: true });
    this.first = true;
  }
  _transform(chunk: any, encoding: string, callback: TransformCallback) {
    console.log(chunk);
    if (this.first) {
      this.first = false;
    } else {
      this.push(',\n')
    }
    this.push(JSON.stringify(chunk));
    if (chunk.Type === 'container' && chunk.Action === 'die' && chunk.Actor.Attributes.name.startsWith('crawler')) {
      if (chunk.Actor.Attributes.exitCode === "0") {
        console.log(`${chunk.Actor.Attributes.name} exited successfully`);
      } else {
        console.log(`${chunk.Actor.Attributes.name} failed`);
      }
      this.emit('workercompleted', chunk.Actor.ID);
    }
    callback();
  }
}
