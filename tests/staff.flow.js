// End-to-end check of staff and gate-device administration against a development database.
//   DATABASE_URL=... DB_SSL=false JWT_SECRET=x node tests/staff.flow.js
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = 'true';
process.env.OTP_DEBUG_RETURN = 'true';
process.env.OTP_RESEND_GAP_SECONDS = '0';

const assert = require('node:assert/strict');
const app = require('../src/app');
const pool = require('../src/db/pool');

let base;
let phoneSequence = 0;

async function call(method, path, body, token) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, ...(await response.json()) };
}

async function login(phone) {
  const request = await call('POST', '/auth/otp/request', { phone });
  assert.equal(request.status, 200, JSON.stringify(request));
  const verify = await call('POST', '/auth/otp/verify', { phone, otp: request.data.dev_otp });
  assert.equal(verify.status, 200, JSON.stringify(verify));
  return verify.data;
}

function uniquePhone() {
  phoneSequence++;
  return `98${String(Date.now()).slice(-6)}${String(phoneSequence).padStart(2, '0')}`;
}

function step(message) {
  console.log('ok  -', message);
}

async function pairGuard(adminToken, guard, gateId, pushToken) {
  const code = await call('POST', '/auth/guard/pairing-codes', {
    gate_id: gateId,
    staff_id: guard.active_profile.profile_id,
  }, adminToken);
  assert.equal(code.status, 201, JSON.stringify(code));
  const paired = await call('POST', '/auth/guard/pair', {
    code: code.data.code,
    platform: 'android',
    push_token: pushToken,
    device_label: 'Staff flow phone',
  }, guard.access_token);
  assert.equal(paired.status, 200, JSON.stringify(paired));
  return paired.data;
}

(async () => {
  const server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  try {
    const admin = await login('9000000001');
    assert.equal(admin.active_profile.role, 'admin');
    const token = admin.access_token;
    const societyId = admin.active_profile.society_id;
    const selfId = admin.active_profile.profile_id;
    assert.equal((await call('DELETE', `/staff/${selfId}`, undefined, token)).status, 409);
    const selfSuspend = await call('PATCH', `/staff/${selfId}`, { status: 'suspended' }, token);
    assert.equal(selfSuspend.status, 409);

    const gateList = await call('GET', '/gates?page=1&limit=100', undefined, token);
    assert.equal(gateList.status, 200, JSON.stringify(gateList));
    let gate = gateList.data.items.find((item) => item.status === 'active');
    if (!gate) {
      const createdGate = await call('POST', '/gates', { name: `Staff flow ${Date.now()}` }, token);
      assert.equal(createdGate.status, 201, JSON.stringify(createdGate));
      gate = createdGate.data;
    }

    const originalPhone = uniquePhone();
    const add = await call('POST', '/staff', {
      full_name: 'Staff Flow Guard',
      phone: originalPhone,
      shift: 'day',
    }, token);
    assert.equal(add.status, 201, JSON.stringify(add));
    const staffId = add.data.id;
    assert.equal(add.data.role, 'guard');
    assert.equal(add.data.status, 'invited');
    assert.equal(add.data.has_logged_in, false);
    assert.equal((await call('POST', '/staff', {
      full_name: 'Duplicate Guard',
      phone: originalPhone,
      shift: 'night',
    }, token)).status, 409);
    assert.equal((await call('POST', '/staff', {
      full_name: 'Missing Shift',
      phone: uniquePhone(),
    }, token)).status, 400);
    assert.equal((await call('POST', '/staff', {
      full_name: 'Admin With Shift',
      phone: uniquePhone(),
      role: 'admin',
      shift: 'day',
    }, token)).status, 400);

    assert.equal((await call('DELETE', `/staff/${staffId}`, undefined, token)).status, 200);
    const readded = await call('POST', '/staff', {
      full_name: 'Staff Flow Guard',
      phone: originalPhone,
      shift: 'night',
    }, token);
    assert.equal(readded.status, 201, JSON.stringify(readded));
    assert.equal(readded.data.id, staffId);
    assert.equal(readded.data.status, 'invited');

    const guardPhone = uniquePhone();
    const edited = await call('PATCH', `/staff/${staffId}`, {
      full_name: 'Staff Flow Guard Edited',
      phone: guardPhone,
      shift: 'general',
      photo_path: 'staff/flow/guard.jpg',
    }, token);
    assert.equal(edited.status, 200, JSON.stringify(edited));
    assert.equal(edited.data.phone, `+91${guardPhone}`);
    assert.equal(edited.data.shift, 'general');
    const staffDetails = await call('GET', `/staff/${staffId}`, undefined, token);
    assert.equal(staffDetails.status, 200, JSON.stringify(staffDetails));
    assert.ok(staffDetails.data.created_at);

    let guard = await login(guardPhone);
    assert.equal(guard.active_profile.role, 'guard');
    assert.equal(guard.active_profile.gate_id, null);
    assert.ok(guard.profiles.some((profile) => profile.role === 'guard' && profile.society_id === societyId));
    assert.equal((await call('PATCH', `/staff/${staffId}`, { phone: uniquePhone() }, token)).status, 400);
    const activeStaff = await call(
      'GET',
      '/staff?role=guard&status=active&search=Staff%20Flow%20Guard%20Edited&page=1&limit=1',
      undefined,
      token
    );
    assert.equal(activeStaff.status, 200, JSON.stringify(activeStaff));
    assert.equal(activeStaff.data.items[0].id, staffId);
    assert.equal(activeStaff.data.items[0].has_logged_in, true);
    step('add, validate, edit, invite login, and filter staff');

    let pairResult = await pairGuard(token, guard, gate.id, `staff-flow-${Date.now()}-1`);
    guard = { ...guard, access_token: pairResult.access_token };
    assert.equal(pairResult.active_profile.gate_id, gate.id);
    let devices = await call('GET', `/gate-devices?status=active&gate_id=${gate.id}`, undefined, token);
    assert.equal(devices.status, 200, JSON.stringify(devices));
    let device = devices.data.find((item) => item.staff_id === staffId);
    assert.ok(device);
    assert.equal(device.platform, 'android');
    assert.equal(device.status, 'active');
    assert.equal((await call('POST', `/gate-devices/${device.id}/revoke`, undefined, token)).status, 200);
    const repeatedRevoke = await call('POST', `/gate-devices/${device.id}/revoke`, undefined, token);
    assert.equal(repeatedRevoke.status, 409);
    assert.equal(repeatedRevoke.message, 'Already unpaired');

    pairResult = await pairGuard(token, guard, gate.id, `staff-flow-${Date.now()}-2`);
    guard = { ...guard, access_token: pairResult.access_token };
    const suspended = await call('PATCH', `/staff/${staffId}`, { status: 'suspended' }, token);
    assert.equal(suspended.status, 200, JSON.stringify(suspended));
    assert.equal(suspended.data.status, 'suspended');
    assert.equal(suspended.data.paired, false);
    const suspendedLogin = await login(guardPhone);
    assert.ok(!suspendedLogin.profiles.some((profile) => profile.role === 'guard' && profile.society_id === societyId));
    const suspendedList = await call('GET', '/staff?role=guard&status=suspended', undefined, token);
    assert.ok(suspendedList.data.items.some((item) => item.id === staffId));
    step('pair/revoke devices and suspend removes the guard role and gate');

    const reactivated = await call('PATCH', `/staff/${staffId}`, { status: 'active' }, token);
    assert.equal(reactivated.status, 200, JSON.stringify(reactivated));
    guard = await login(guardPhone);
    assert.equal(guard.active_profile.role, 'guard');
    pairResult = await pairGuard(token, guard, gate.id, `staff-flow-${Date.now()}-3`);
    guard = { ...guard, access_token: pairResult.access_token };
    const removed = await call('DELETE', `/staff/${staffId}`, undefined, token);
    assert.equal(removed.status, 200, JSON.stringify(removed));
    assert.equal(removed.data.status, 'removed');
    assert.equal(removed.data.paired, false);
    const removedLogin = await login(guardPhone);
    assert.ok(!removedLogin.profiles.some((profile) => profile.role === 'guard' && profile.society_id === societyId));
    const removedList = await call('GET', '/staff?role=guard&status=removed&search=Edited', undefined, token);
    assert.ok(removedList.data.items.some((item) => item.id === staffId));
    step('reactivate, remove, revoke pairing, and exclude removed guard from login');

    const founder = await login(uniquePhone());
    const registered = await call('POST', '/auth/admin/register-society', {
      society_name: `Staff flow isolated ${Date.now()}`,
      admin_name: 'Staff Flow Admin One',
    }, founder.access_token);
    assert.equal(registered.status, 201, JSON.stringify(registered));
    const isolatedAdminOne = registered.data;
    const adminOneId = isolatedAdminOne.active_profile.profile_id;
    const adminTwoPhone = uniquePhone();
    const addAdmin = await call('POST', '/staff', {
      full_name: 'Staff Flow Admin Two',
      phone: adminTwoPhone,
      role: 'admin',
    }, isolatedAdminOne.access_token);
    assert.equal(addAdmin.status, 201, JSON.stringify(addAdmin));
    const adminTwo = await login(adminTwoPhone);
    assert.equal(adminTwo.active_profile.role, 'admin');
    const adminTwoId = adminTwo.active_profile.profile_id;
    assert.equal((await call('PATCH', `/staff/${adminOneId}`, { status: 'suspended' }, adminTwo.access_token)).status, 200);
    const lastAdmin = await call('DELETE', `/staff/${adminTwoId}`, undefined, isolatedAdminOne.access_token);
    assert.equal(lastAdmin.status, 409);
    assert.match(lastAdmin.message, /last active admin/i);

    const foreignPhone = uniquePhone();
    const foreignGuard = await call('POST', '/staff', {
      full_name: 'Foreign Society Guard',
      phone: foreignPhone,
      shift: 'day',
    }, adminTwo.access_token);
    assert.equal(foreignGuard.status, 201, JSON.stringify(foreignGuard));
    assert.equal((await call('GET', `/staff/${foreignGuard.data.id}`, undefined, token)).status, 404);
    const foreignGateList = await call('GET', '/gates?page=1&limit=100', undefined, adminTwo.access_token);
    const foreignGate = foreignGateList.data.items.find((item) => item.status === 'active');
    assert.ok(foreignGate);
    const foreignGuardLogin = await login(foreignPhone);
    assert.equal(foreignGuardLogin.active_profile.role, 'guard');
    await pairGuard(adminTwo.access_token, foreignGuardLogin, foreignGate.id, `staff-flow-foreign-${Date.now()}`);
    const foreignDevices = await call('GET', '/gate-devices?status=active', undefined, adminTwo.access_token);
    const foreignDevice = foreignDevices.data.find((item) => item.staff_id === foreignGuard.data.id);
    assert.ok(foreignDevice);
    assert.equal((await call('POST', `/gate-devices/${foreignDevice.id}/revoke`, undefined, token)).status, 404);
    assert.equal((await call('GET', `/gate-devices?gate_id=${foreignGate.id}`, undefined, token)).status, 404);
    step('protect last admin and isolate staff/device ids by society');

    console.log('\nALL STAFF FLOW TESTS PASSED');
  } catch (error) {
    console.error('\nFAILED:', error.message);
    process.exitCode = 1;
  } finally {
    server.close();
    await pool.end();
  }
})();
