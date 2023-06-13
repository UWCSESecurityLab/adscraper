export function error(e: Error) {
  let jsonLog = {
    level: 'ERROR',
    message: e.message,
    stack: e.stack
  }
  console.log(JSON.stringify(jsonLog));
}

export function strError(message: string) {
  let jsonLog = {
    level: 'ERROR',
    message: message
  }
  console.log(JSON.stringify(jsonLog));
}

export function warning(message: string) {
  let jsonLog = {
    level: 'WARNING',
    message: message
  }
  console.log(JSON.stringify(jsonLog));
}

export function debug(message: string) {
  let jsonLog = {
    level: 'DEBUG',
    message: message
  }
  console.log(JSON.stringify(jsonLog));
}

export function info(message: string) {
  let jsonLog = {
    level: 'INFO',
    message: message
  }
  console.log(JSON.stringify(jsonLog));
}

export function verbose(message: string) {
  let jsonLog = {
    level: 'VERBOSE',
    message: message
  }
  console.log(JSON.stringify(jsonLog));
}