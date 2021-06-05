import { Transform, TransformCallback } from 'stream';

// Parses logs from Docker events, adds a log type to distinguish it from
// container logs.
export default class DockerEventTransformer extends Transform {
  constructor() {
    super({ objectMode: true });
  }
  _transform(chunk: Buffer, encoding: string, callback: TransformCallback) {
    try {
      let data = JSON.parse(chunk.toString());
      data.logType = 'eventLog';
      this.push(data);
    } catch (e) {
      console.log(e);
      console.log(chunk);
    } finally {
      callback();
    }
  }
}