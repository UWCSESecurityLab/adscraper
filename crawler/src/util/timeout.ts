// Asynchronous timeout function. Returns a Promise, which throws an Error
// with the given |message| if |ms| milliseconds passes. Also returns a
// timeout id, can be used to cancel the timeout.
export function createAsyncTimeout<T>(message: string, ms: number): [Promise<T>, NodeJS.Timeout] {
  let timeoutId: NodeJS.Timeout;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${message} - ${ms}ms`));
    }, ms);
  });
  // @ts-ignore
  return [timeout, timeoutId];
}

// Asynchronous sleep function. Returns a Promise that resolves after |ms|
// milliseconds.
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}