// Login flow: OTP -> tokens, refresh, logout, who am I, switch role.
const { query } = require('../db/query');
const ApiError = require('../utils/ApiError');
const otpService = require('./otp.service');
const firebaseAuthService = require('./firebase-auth.service');
const tokenService = require('./token.service');
const profileService = require('./profile.service');

async function getUser(userId) {
  const { rows } = await query(
    `select id, phone, full_name, photo_path, language, status from users where id = $1`,
    [userId]
  );
  const user = rows[0];
  if (!user) throw new ApiError(401, 'Account not found. Please log in again.');
  if (user.status === 'blocked') throw new ApiError(403, 'This account is blocked. Contact your society admin.');
  return user;
}

function sendOtp(phone, ip) {
  return otpService.requestOtp(phone, ip);
}

async function verifyOtpAndLogin(phone, otp, meta) {
  await otpService.verifyOtp(phone, otp);

  return loginWithVerifiedPhone(phone, meta);
}

async function verifyFirebaseTokenAndLogin(idToken, meta) {
  const phone = await firebaseAuthService.verifyPhoneIdToken(idToken);
  return loginWithVerifiedPhone(phone, meta);
}

async function loginWithVerifiedPhone(phone, meta) {
  const { rows } = await query(
    `insert into users (phone, phone_verified_at, last_login_at) values ($1, now(), now())
     on conflict (phone) do update
        set phone_verified_at = coalesce(users.phone_verified_at, now()), last_login_at = now()
     returning id, phone, full_name, photo_path, language, status`,
    [phone]
  );
  const user = rows[0];
  if (user.status === 'blocked') throw new ApiError(403, 'This account is blocked. Contact your society admin.');

  await profileService.linkPhoneToProfiles(user.id, phone);
  const profiles = await profileService.loadProfiles(user.id);
  const active = profileService.pickDefault(profiles);
  const refreshToken = await tokenService.createSession(user.id, meta);

  return {
    ...tokenService.accessTokenResponse(user.id, active),
    refresh_token: refreshToken,
    is_new_user: profiles.length === 0, // app should show "create society" / "join society"
    user,
    active_profile: active,
    profiles,
  };
}

// roleChoice is optional: the app sends the role the person last used so a refresh keeps it
async function refresh(refreshToken, roleChoice, meta) {
  const { userId, refreshToken: newRefresh } = await tokenService.rotateSession(refreshToken, meta);
  const user = await getUser(userId);
  const profiles = await profileService.loadProfiles(userId);

  const chosen =
    roleChoice && roleChoice.role
      ? profileService.findProfile(profiles, roleChoice.role, roleChoice.society_id)
      : null;
  const active = chosen || profileService.pickDefault(profiles);

  return {
    ...tokenService.accessTokenResponse(userId, active),
    refresh_token: newRefresh,
    user,
    active_profile: active,
    profiles,
  };
}

async function logout(refreshToken) {
  await tokenService.revokeSession(refreshToken);
}

async function me(auth) {
  const user = await getUser(auth.userId);
  const profiles = await profileService.loadProfiles(auth.userId);
  const active =
    profiles.find((p) => p.role === auth.role && p.society_id === auth.societyId) || null;
  return { user, active_profile: active, profiles };
}

async function switchRole(auth, role, societyId) {
  await getUser(auth.userId);
  const profiles = await profileService.loadProfiles(auth.userId);
  const profile = profileService.findProfile(profiles, role, societyId);
  if (!profile) throw new ApiError(404, 'You do not have that role in that society.');
  return { ...tokenService.accessTokenResponse(auth.userId, profile), active_profile: profile };
}

module.exports = {
  sendOtp,
  verifyOtpAndLogin,
  verifyFirebaseTokenAndLogin,
  refresh,
  logout,
  me,
  switchRole,
  getUser,
};
