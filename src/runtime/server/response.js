export { respondError, setOnError} from './response/respondError.js';

const { stringify } = JSON;

function writeResponse(res, status, headers, body) {
  if (status !== 0) {
    res.writeStatus(status + '');
  }

  for (let i = 0; i < headers.length; i++) {
    res.writeHeader(headers[i], headers[++i]);
  }

  res.end(body);
}

export function respondNoContent(res) {
  if (res.context.isConnected) {
    res.cork(() => {
      writeResponse(
        res,
        res.context.response.status || 204,
        res.context.response.headers,
        undefined,
      );
    });
  }
}

export function respondBinary(res, body) {
  if (body === undefined) {
    respondNoContent(res);
  } else if (res.context.isConnected) {
    res.cork(() => {
      writeResponse(
        res,
        res.context.response.status,
        res.context.response.headers,
        body,
      );
    });
  }
}

export function respondJson(res, data) {
  if (data === undefined) {
    respondNoContent(res);
  } else if (res.context.isConnected) {
    res.context.response.headers.push('content-type', 'application/json');

    res.cork(() => {
      writeResponse(
        res,
        res.context.response.status,
        res.context.response.headers,
        stringify({ data }),
      );
    });
  }
}
