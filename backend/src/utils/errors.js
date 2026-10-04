export class HttpError extends Error {
  constructor(status, message, code = 'ERROR', extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export class BookingError extends HttpError {
  constructor(message, status = 400, code = 'BAD_REQUEST', extra = {}) {
    super(status, message, code, extra);
  }
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
