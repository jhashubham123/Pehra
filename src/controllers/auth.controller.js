// Reads the request, calls the auth service, sends the response.
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const authService = require('../services/auth.service');

const meta = (req) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

exports.requestOtp = asyncHandler(async (req, res) => {
  const data = await authService.sendOtp(req.body.phone, req.ip);
  ok(res, data, 'OTP sent');
});

exports.verifyOtp = asyncHandler(async (req, res) => {
  const data = await authService.verifyOtpAndLogin(req.body.phone, req.body.otp, meta(req));
  ok(res, data, 'Logged in');
});

exports.verifyFirebaseToken = asyncHandler(async (req, res) => {
  const data = await authService.verifyFirebaseTokenAndLogin(req.body.id_token, meta(req));
  ok(res, data, 'Logged in');
});

exports.refresh = asyncHandler(async (req, res) => {
  const { refresh_token: token, role, society_id: societyId } = req.body;
  const data = await authService.refresh(token, { role, society_id: societyId }, meta(req));
  ok(res, data, 'Token refreshed');
});

exports.logout = asyncHandler(async (req, res) => {
  await authService.logout(req.body.refresh_token);
  ok(res, null, 'Logged out');
});

exports.me = asyncHandler(async (req, res) => {
  ok(res, await authService.me(req.auth));
});

exports.switchRole = asyncHandler(async (req, res) => {
  const data = await authService.switchRole(req.auth, req.body.role, req.body.society_id);
  ok(res, data, 'Role switched');
});
