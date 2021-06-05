import { Transform, TransformCallback } from 'stream';

// Parses logs from containers into JSON objects, and adds the container name
// and ID. If the log is not in JSON format, converts it into a JSON-formatted
// log.
export default class ContainerLogTransformer extends Transform {
  containerName: string;
  containerId: string;

  constructor(containerName: string, containerId: string) {
    super({objectMode: true});
    this.containerName = containerName;
    this.containerId = containerId;
  }

  _transform(chunk: Buffer, encoding: string, callback: TransformCallback) {
    let chunkstr = chunk.slice(8).toString();
    let jsonLog: any = {
      logType: 'containerLog'
    };

    try {
      // Try to parse JSON from the log
      let chunkJson = JSON.parse(chunkstr);
      Object.assign(jsonLog, chunkJson);
    } catch (e) {
      if (e.name === 'SyntaxError') {
        // If it wasn't JSON, just use the string as the message
        jsonLog.level = 'INFO';
        jsonLog.message = chunkstr;
      } else {
        throw e;
      }
    }

    // Tag the logs with container name and id
    jsonLog.containerName = this.containerName;
    jsonLog.containerId = this.containerId;
    jsonLog.time = Math.round(Date.now()/1000);
    this.push(jsonLog);
    callback();
  }
}