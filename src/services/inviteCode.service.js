const { randomDigits } = require('../utils/crypto');

function makeInviteCode(name) {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X');
  return `${letters}-${randomDigits(4)}`;
}

module.exports = { makeInviteCode };
