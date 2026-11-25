/** Errors that cross layers. Routes turn them into HTTP responses; nothing else knows about HTTP. */
export class HttpError extends Error {
  constructor(status, message) { super(message); this.name = "HttpError"; this.status = status; }
}
export class ValidationError extends HttpError {
  constructor(message) { super(400, message); this.name = "ValidationError"; }
}
/** A database constraint was broken. kind: unique | fk | check | notnull */
export class DbError extends Error {
  constructor(kind, message) { super(message); this.name = "DbError"; this.kind = kind; }
}
export const notFound = (what = "not found") => new HttpError(404, what);
export const forbidden = (what = "you do not have permission for that") => new HttpError(403, what);
