const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const flatService = require('../services/flat.service');
const residentService = require('../services/resident.service');

exports.list = asyncHandler(async (req, res) => {
  ok(res, await flatService.list(req.auth, req.query));
});

exports.create = asyncHandler(async (req, res) => {
  created(res, await flatService.create(req.auth, req.body), 'Flat created');
});

exports.update = asyncHandler(async (req, res) => {
  ok(res, await flatService.update(req.auth, req.params.id, req.body), 'Flat updated');
});

exports.remove = asyncHandler(async (req, res) => {
  ok(res, await flatService.remove(req.auth, req.params.id), 'Flat deleted');
});

exports.registerFamily = asyncHandler(async (req, res) => {
  created(
    res,
    {
      members: await residentService.registerFamily(req.auth, req.params.flatId, req.body.members),
    },
    'Family registered'
  );
});
