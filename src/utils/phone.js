// Turns what a person types into E.164 (+919876543210), or null if it is not a valid number.
function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let p = input.replace(/[\s\-().]/g, '');

  if (p.startsWith('+')) {
    // already international
  } else if (/^[6-9]\d{9}$/.test(p)) {
    p = '+91' + p; // 10-digit Indian mobile
  } else if (/^91[6-9]\d{9}$/.test(p)) {
    p = '+' + p;
  } else if (/^0[6-9]\d{9}$/.test(p)) {
    p = '+91' + p.slice(1);
  } else {
    return null;
  }

  return /^\+[1-9][0-9]{7,14}$/.test(p) ? p : null; // same rule as the database
}

module.exports = { normalizePhone };
