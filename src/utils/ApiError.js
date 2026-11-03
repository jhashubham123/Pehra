// An error we throw on purpose, with the HTTP status to send back.
//   throw new ApiError(404, 'Flat not found');
class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors; // optional list of field problems
  }
}

module.exports = ApiError;
