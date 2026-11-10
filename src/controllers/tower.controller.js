const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const towerService = require('../services/tower.service');

exports.list = asyncHandler(async (req, res) => {
  ok(res, await towerService.list(req.auth, req.query));
});

exports.create = asyncHandler(async (req, res) => {
  created(res, await towerService.create(req.auth, req.body), 'Tower created');
});

exports.update = asyncHandler(async (req, res) => {
  ok(res, await towerService.update(req.auth, req.params.id, req.body), 'Tower updated');
});

exports.remove = asyncHandler(async (req, res) => {
  ok(res, await towerService.remove(req.auth, req.params.id), 'Tower deleted');
});

exports.generateFlats = asyncHandler(async (req, res) => {
  created(res, await towerService.generateFlats(req.auth, req.params.id, req.body), 'Flats generated');
});
