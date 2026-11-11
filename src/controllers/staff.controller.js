const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const staffService = require('../services/staff.service');

exports.list = asyncHandler(async (req, res) => {
  ok(res, await staffService.list(req.auth, req.query));
});

exports.create = asyncHandler(async (req, res) => {
  created(res, await staffService.create(req.auth, req.body), 'Staff member added');
});

exports.get = asyncHandler(async (req, res) => {
  ok(res, await staffService.get(req.auth, req.params.id));
});

exports.update = asyncHandler(async (req, res) => {
  ok(res, await staffService.update(req.auth, req.params.id, req.body), 'Staff member updated');
});

exports.remove = asyncHandler(async (req, res) => {
  ok(res, await staffService.remove(req.auth, req.params.id), 'Staff member removed');
});

exports.listGateDevices = asyncHandler(async (req, res) => {
  ok(res, await staffService.listGateDevices(req.auth, req.query));
});

exports.revokeGateDevice = asyncHandler(async (req, res) => {
  ok(res, await staffService.revokeGateDevice(req.auth, req.params.id), 'Device unpaired');
});
