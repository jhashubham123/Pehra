const ApiError = require('./ApiError');

function throwDatabaseError(error, { alreadyExists = 'This record' } = {}) {
  if (error.code === '23505') {
    throw new ApiError(409, `${alreadyExists} already exists.`);
  }
  if (error.code === '23503') {
    throw new ApiError(409, 'This record is still in use.');
  }
  throw error;
}

module.exports = { throwDatabaseError };
