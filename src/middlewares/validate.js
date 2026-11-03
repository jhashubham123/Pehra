// Checks req.body (or query/params) against a zod schema. Cleaned values replace the originals.
//   router.post('/x', validate(mySchema), controller)
const ApiError = require('../utils/ApiError');

module.exports = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const errors = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return next(new ApiError(400, errors[0].message, errors));
  }
  req[source] = result.data;
  next();
};
