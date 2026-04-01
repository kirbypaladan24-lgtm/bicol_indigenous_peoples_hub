export class ApiError extends Error {
  constructor(statusCode, message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = options.code || null;
    this.details = options.details || null;
  }
}

export function badRequest(message, details = null) {
  return new ApiError(400, message, { details });
}

export function unauthorized(message = "Authentication is required.") {
  return new ApiError(401, message);
}

export function forbidden(message = "You do not have permission to perform this action.") {
  return new ApiError(403, message);
}

export function notFound(message = "The requested resource was not found.") {
  return new ApiError(404, message);
}

export function conflict(message = "This action conflicts with existing data.") {
  return new ApiError(409, message);
}

export function serviceUnavailable(message = "The service is not ready right now.") {
  return new ApiError(503, message);
}
