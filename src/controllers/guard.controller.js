const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const pairing = require('../services/guardPairing.service');

exports.createPairingCode = asyncHandler(async (req, res) => {
  created(res, await pairing.createPairingCode(req.auth, req.body), 'Pairing code created');
});

exports.pairDevice = asyncHandler(async (req, res) => {
  ok(res, await pairing.pairDevice(req.auth, req.body), 'Phone paired to gate');
});
