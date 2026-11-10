const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const societyService = require('../services/society.service');

exports.get = asyncHandler(async (req, res) => {
  ok(res, await societyService.getSociety(req.auth));
});

exports.update = asyncHandler(async (req, res) => {
  ok(res, await societyService.updateSociety(req.auth, req.body), 'Society updated');
});

exports.rotateInviteCode = asyncHandler(async (req, res) => {
  ok(res, await societyService.rotateInviteCode(req.auth), 'Invite code rotated');
});
