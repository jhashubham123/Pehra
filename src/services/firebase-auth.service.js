// Verifies Firebase ID tokens using the Admin SDK service-account credential.
const fs = require('node:fs');
const path = require('node:path');
const { cert, initializeApp } = require('firebase-admin/app');
const { getAuth: getFirebaseAuth } = require('firebase-admin/auth');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { normalizePhone } = require('../utils/phone');

let firebaseAuth;

function loadServiceAccount() {
  let raw = env.firebaseServiceAccountJson;

  if (!raw && env.firebaseServiceAccountPath) {
    const filePath = path.resolve(env.firebaseServiceAccountPath);
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      throw new ApiError(503, 'Firebase authentication credentials could not be loaded.');
    }
  }

  if (!raw) {
    throw new ApiError(503, 'Firebase authentication is not configured on the API.');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new ApiError(503, 'Firebase service-account credentials are not valid JSON.');
  }

  if (
    !serviceAccount.project_id ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
  ) {
    throw new ApiError(503, 'Firebase service-account credentials are missing required fields.');
  }
  if (serviceAccount.project_id !== env.firebaseProjectId) {
    throw new ApiError(503, 'Firebase service-account project does not match FIREBASE_PROJECT_ID.');
  }

  return serviceAccount;
}

function getConfiguredAuth() {
  if (firebaseAuth) return firebaseAuth;

  const serviceAccount = loadServiceAccount();
  const app = initializeApp(
    {
      credential: cert(serviceAccount),
      projectId: env.firebaseProjectId,
    },
    'pehra-api'
  );
  firebaseAuth = getFirebaseAuth(app);
  return firebaseAuth;
}

async function verifyPhoneIdToken(idToken) {
  const auth = getConfiguredAuth();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch (error) {
    if (
      ['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired'].includes(error.code)
    ) {
      throw new ApiError(401, 'Firebase ID token is invalid or expired. Please sign in again.');
    }
    throw error;
  }

  if (decoded.firebase?.sign_in_provider !== 'phone' || !decoded.phone_number) {
    throw new ApiError(401, 'A verified Firebase phone sign-in is required.');
  }

  const phone = normalizePhone(decoded.phone_number);
  if (!phone) throw new ApiError(401, 'Firebase account does not have a valid phone number.');
  return phone;
}

module.exports = { verifyPhoneIdToken };
