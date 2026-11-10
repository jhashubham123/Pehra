const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const joinRequestService = require('../services/joinRequest.service');

exports.list = asyncHandler(async (req, res) => {
  ok(res, await joinRequestService.list(req.auth, req.query));
});

exports.approve = asyncHandler(async (req, res) => {
  ok(res, await joinRequestService.approve(req.auth, req.params.id, req.body), 'Join request approved');
});

exports.decline = asyncHandler(async (req, res) => {
  ok(res, await joinRequestService.decline(req.auth, req.params.id, req.body), 'Join request declined');
});
