const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const onboardingService = require('../services/onboarding.service');

exports.registerSociety = asyncHandler(async (req, res) => {
  created(res, await onboardingService.registerSociety(req.auth, req.body), 'Society created');
});

exports.joinAsResident = asyncHandler(async (req, res) => {
  const data = await onboardingService.joinAsResident(req.auth, req.body);
  created(res, data, data.message);
});
