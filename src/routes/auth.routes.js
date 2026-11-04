// URL -> middlewares -> controller. No logic here.
const router = require('express').Router();
const validate = require('../middlewares/validate');
const authenticate = require('../middlewares/authenticate');
const authorizeRole = require('../middlewares/authorizeRole');
const limiter = require('../middlewares/rateLimiter');
const v = require('../validators/auth.validator');
const auth = require('../controllers/auth.controller');
const onboarding = require('../controllers/onboarding.controller');
const guard = require('../controllers/guard.controller');

// --- login (public) ---
router.post('/otp/request', limiter.otp, validate(v.otpRequest), auth.requestOtp);
router.post('/otp/verify', limiter.otp, validate(v.otpVerify), auth.verifyOtp);
router.post('/firebase/verify', limiter.otp, validate(v.firebaseToken), auth.verifyFirebaseToken);
router.post('/refresh', validate(v.refresh), auth.refresh);
router.post('/logout', validate(v.logout), auth.logout);

// --- any logged-in person ---
router.get('/me', authenticate, auth.me);
router.post('/switch-role', authenticate, validate(v.switchRole), auth.switchRole);

// --- new person: make a society, or ask to join one ---
router.post('/admin/register-society', authenticate, validate(v.registerSociety), onboarding.registerSociety);
router.post('/resident/join', authenticate, validate(v.residentJoin), onboarding.joinAsResident);

// --- guard phone pairing ---
router.post('/guard/pairing-codes', authenticate, authorizeRole('admin'), validate(v.createPairingCode), guard.createPairingCode);
router.post('/guard/pair', limiter.pairing, authenticate, authorizeRole('guard'), validate(v.pairDevice), guard.pairDevice);

module.exports = router;
