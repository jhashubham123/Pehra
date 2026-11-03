// End-to-end check of the auth APIs against a real database.
//   DATABASE_URL=... DB_SSL=false JWT_SECRET=x OTP_DEBUG_RETURN=true node tests/auth.flow.js
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = 'true';
process.env.OTP_DEBUG_RETURN = 'true';
process.env.OTP_RESEND_GAP_SECONDS = '0';

const assert = require('node:assert/strict');
const app = require('../src/app');

let base;
async function call(method, path, body, token) {
  const res = await fetch(base + '/api/v1' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(await res.json()) };
}
const step = (m) => console.log('ok  -', m);

async function login(phone) {
  const r = await call('POST', '/auth/otp/request', { phone });
  assert.equal(r.status, 200, JSON.stringify(r));
  const v = await call('POST', '/auth/otp/verify', { phone, otp: r.data.dev_otp });
  assert.equal(v.status, 200, JSON.stringify(v));
  return v.data;
}

(async () => {
  const server = app.listen(0);
  base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await call('GET', '/health')).status, 200); step('health');

    // validation + wrong OTP
    assert.equal((await call('POST', '/auth/otp/request', { phone: '123' })).status, 400); step('bad phone rejected');
    await call('POST', '/auth/otp/request', { phone: '9000000002' });
    const wrong = await call('POST', '/auth/otp/verify', { phone: '9000000002', otp: '000000' });
    assert.equal(wrong.status, 400); step('wrong OTP rejected: ' + wrong.message);
    assert.equal((await call('GET', '/auth/me')).status, 401); step('me without token is 401');

    // ---- GUARD (seed: Suresh, already paired to Main Gate) ----
    const guard = await login('+91 90000 00002');
    assert.equal(guard.active_profile.role, 'guard');
    assert.ok(guard.active_profile.gate_id, 'seed guard is paired');
    step('guard login, paired gate = ' + guard.active_profile.gate_name);

    // ---- ADMIN (seed: Rakesh) ----
    const admin = await login('9000000001');
    assert.equal(admin.active_profile.role, 'admin');
    step('admin login: ' + admin.active_profile.society_name);

    // admin makes a code, an unpaired guard (Ramesh, invited in seed) pairs a phone
    const gates = admin.active_profile.society_id;
    const gateRow = guard.active_profile.gate_id;
    const code = await call('POST', '/auth/guard/pairing-codes', { gate_id: gateRow }, admin.access_token);
    assert.equal(code.status, 201, JSON.stringify(code)); step('admin created pairing code');

    const guard2 = await login('9000000006'); // Ramesh Patil, invited
    assert.equal(guard2.active_profile.role, 'guard');
    assert.equal(guard2.active_profile.gate_id, null); step('new guard logs in unpaired -> gate_id null');

    const notAdmin = await call('POST', '/auth/guard/pairing-codes', { gate_id: gateRow }, guard2.access_token);
    assert.equal(notAdmin.status, 403); step('guard cannot create pairing codes');

    const badPair = await call('POST', '/auth/guard/pair', { code: '000000', platform: 'android', push_token: 'token-ramesh-1' }, guard2.access_token);
    assert.equal(badPair.status, 400); step('wrong pairing code rejected');

    const pair = await call('POST', '/auth/guard/pair', { code: code.data.code, platform: 'android', push_token: 'token-ramesh-1', device_label: 'Gate phone' }, guard2.access_token);
    assert.equal(pair.status, 200, JSON.stringify(pair));
    assert.equal(pair.data.active_profile.gate_id, gateRow); step('guard paired, new token has gate');

    const again = await call('POST', '/auth/guard/pair', { code: code.data.code, platform: 'android', push_token: 'token-ramesh-1' }, guard2.access_token);
    assert.equal(again.status, 400); step('pairing code works only once');

    // ---- refresh rotation + logout ----
    const r1 = await call('POST', '/auth/refresh', { refresh_token: admin.refresh_token });
    assert.equal(r1.status, 200); step('refresh works');
    const r2 = await call('POST', '/auth/refresh', { refresh_token: admin.refresh_token });
    assert.equal(r2.status, 401); step('old refresh token cannot be reused');
    await call('POST', '/auth/logout', { refresh_token: r1.data.refresh_token });
    assert.equal((await call('POST', '/auth/refresh', { refresh_token: r1.data.refresh_token })).status, 401); step('logout kills session');

    // ---- NEW PERSON becomes society admin ----
    const founder = await login('9811111111');
    assert.equal(founder.is_new_user, true);
    assert.equal(founder.active_profile, null); step('brand-new user has no role');
    const reg = await call('POST', '/auth/admin/register-society', { society_name: 'Green Valley', admin_name: 'Anil Kapoor', city: 'Pune', pincode: '411045' }, founder.access_token);
    assert.equal(reg.status, 201, JSON.stringify(reg));
    assert.equal(reg.data.active_profile.role, 'admin');
    const inviteCode = reg.data.society.invite_code;
    step('society created, invite code ' + inviteCode);

    // ---- NEW PERSON joins a flat as resident (needs flats; seed society has B-402) ----
    const joiner = await login('9822222222');
    const noSociety = await call('POST', '/auth/resident/join', { invite_code: 'NOPE-0000', flat_label: 'B-402', full_name: 'Test', resident_type: 'tenant' }, joiner.access_token);
    assert.equal(noSociety.status, 404); step('unknown society code rejected');
    const noFlat = await call('POST', '/auth/resident/join', { invite_code: 'SUN-4829', flat_label: 'Z-999', full_name: 'Test', resident_type: 'tenant' }, joiner.access_token);
    assert.equal(noFlat.status, 404); step('unknown flat rejected');
    const join = await call('POST', '/auth/resident/join', { invite_code: 'sun-4829', flat_label: 'b-402', full_name: 'Priya Nair', resident_type: 'tenant' }, joiner.access_token);
    assert.equal(join.status, 201, JSON.stringify(join));
    assert.equal(join.data.active_profile.status, 'pending'); step('resident join request is pending');
    const dup = await call('POST', '/auth/resident/join', { invite_code: 'SUN-4829', flat_label: 'B-402', full_name: 'Priya Nair', resident_type: 'tenant' }, joiner.access_token);
    assert.equal(dup.status, 409); step('duplicate join request rejected');

    const blocked = await call('POST', '/auth/guard/pairing-codes', { gate_id: gateRow }, join.data.access_token);
    assert.equal(blocked.status, 403); step('pending resident cannot use admin APIs');

    // ---- RESIDENT (seed: Vikram, active head of B-402) ----
    const res = await login('9000000003'); // Vikram
    assert.equal(res.active_profile.role, 'resident');
    assert.equal(res.active_profile.flat_label, 'B-402'); step('resident login: flat ' + res.active_profile.flat_label);

    const me = await call('GET', '/auth/me', null, res.access_token);
    assert.equal(me.data.active_profile.role, 'resident'); step('/auth/me works');

    const sw = await call('POST', '/auth/switch-role', { role: 'admin', society_id: res.active_profile.society_id }, res.access_token);
    assert.equal(sw.status, 404); step('cannot switch to a role you do not have');

    console.log('\nALL AUTH TESTS PASSED');
  } catch (e) {
    console.error('\nFAILED:', e.message);
    process.exitCode = 1;
  } finally {
    server.close();
    await require('../src/db/pool').end();
  }
})();
