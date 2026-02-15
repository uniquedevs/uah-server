import { isObject } from '#runtime/types/checker.js';
import { stringify } from '#runtime/types/json.js';

export let onError = null;

export function respondError(res, error) {
  if (error) {
    const status = error.status || 500;

    if (isObject(error) === false) {
      error = { type: 'Error', message: error };
    }

    if (res.context.isConnected) {
      res.cork(() => {
        const type = error.type || error.constructor?.name || 'Error';

        res
          .writeStatus(status.toString())
          .writeHeader('cache-control', 'no-store')
          .writeHeader('content-type', 'application/json')
          .end(
            stringify(
              status === 500
                ? { type, status, message: error.message }
                : { type, status, ...error },
            ),
          );
      });
    }

    if (status === 500) {
      console.error(error);
    }
    onError?.(error, status, res.context);
  } else if (res.context.isConnected) {
    res.cork(() => {
      res.writeStatus('204').end();
    });
  }
}

export function respondNoContent(res) {
  res.cork(() => {
    res.writeStatus('204').end();
  });
}
