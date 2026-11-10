const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const residentService = require('../services/resident.service');

exports.list = asyncHandler(async (req, res) => {
  ok(res, await residentService.list(req.auth, req.query));
});

exports.get = asyncHandler(async (req, res) => {
  ok(res, await residentService.get(req.auth, req.params.id));
});

exports.update = asyncHandler(async (req, res) => {
  ok(res, await residentService.update(req.auth, req.params.id, req.body), 'Resident updated');
});

exports.moveOut = asyncHandler(async (req, res) => {
  ok(res, await residentService.moveOut(req.auth, req.params.id, req.body), 'Resident moved out');
});
