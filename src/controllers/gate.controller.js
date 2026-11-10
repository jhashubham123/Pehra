const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const gateService = require('../services/gate.service');

exports.list = asyncHandler(async (req, res) => {
  ok(res, await gateService.list(req.auth, req.query));
});

exports.create = asyncHandler(async (req, res) => {
  created(res, await gateService.create(req.auth, req.body), 'Gate created');
});

exports.update = asyncHandler(async (req, res) => {
  ok(res, await gateService.update(req.auth, req.params.id, req.body), 'Gate updated');
});
