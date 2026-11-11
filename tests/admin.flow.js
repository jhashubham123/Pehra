// End-to-end check of the society-admin APIs against a development database.
//   DATABASE_URL=... DB_SSL=false JWT_SECRET=x node tests/admin.flow.js
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

function step(message) {
  console.log('ok  -', message);
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
  return `99${String(Date.now()).slice(-6)}${String(phoneSequence).padStart(2, '0')}`;
}

(async () => {
  const server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  let societyId;
  let originalInviteCode;

  try {
    const admin = await login('9000000001');
    assert.equal(admin.active_profile.role, 'admin');
    const token = admin.access_token;
    societyId = admin.active_profile.society_id;
    assert.equal((await call('GET', '/society')).status, 401);
    step('demo admin login');

    const society = await call('GET', '/society', undefined, token);
    assert.equal(society.status, 200, JSON.stringify(society));
    originalInviteCode = society.data.invite_code;
    for (const field of ['towers', 'flats', 'active_residents', 'pending_requests', 'active_guards']) {
      assert.ok(field in society.data, `missing society count ${field}`);
    }
    step('society details and counts');

    const invalidPincode = await call('PATCH', '/society', { pincode: '123' }, token);
    assert.equal(invalidPincode.status, 400);
    const updatedSociety = await call('PATCH', '/society', {
      city: society.data.city,
      approval_wait_seconds: society.data.approval_wait_seconds,
    }, token);
    assert.equal(updatedSociety.status, 200, JSON.stringify(updatedSociety));
    step('society patch and validation');

    const invalidList = await call('GET', '/towers?page=0', undefined, token);
    assert.equal(invalidList.status, 400);
    let name = `Flow${String(Date.now()).slice(-7)}`;
    assert.equal((await call('POST', '/towers', { name: `${name}Bad`, floors: 121 }, token)).status, 400);
    const towerResult = await call('POST', '/towers', { name, floors: 4 }, token);
    assert.equal(towerResult.status, 201, JSON.stringify(towerResult));
    const towerId = towerResult.data.id;
    assert.equal(towerResult.data.flat_count, 0);
    assert.equal((await call('POST', '/towers', { name, floors: 2 }, token)).status, 409);
    name = `${name}Updated`;
    const renamedTower = await call('PATCH', `/towers/${towerId}`, { name }, token);
    assert.equal(renamedTower.status, 200);
    assert.equal(renamedTower.data.name, name);

    let towerList = await call('GET', '/towers?page=1&limit=5', undefined, token);
    assert.equal(towerList.status, 200);
    assert.ok(towerList.data.items.some((item) => item.id === towerId));
    const generated = await call('POST', `/towers/${towerId}/flats/generate`, {
      floors_to: 3,
      flats_per_floor: 2,
    }, token);
    assert.equal(generated.status, 201, JSON.stringify(generated));
    assert.deepEqual(generated.data, { created: 6, skipped: 0 });
    const generatedAgain = await call('POST', `/towers/${towerId}/flats/generate`, {
      floors_to: 3,
      flats_per_floor: 2,
    }, token);
    assert.deepEqual(generatedAgain.data, { created: 0, skipped: 6 });
    assert.equal((await call('POST', `/towers/${towerId}/flats/generate`, {
      floors_to: 5,
      flats_per_floor: 1,
    }, token)).status, 400);
    assert.equal((await call('PATCH', `/towers/${towerId}`, { floors: 5 }, token)).status, 200);
    assert.equal((await call('PATCH', `/towers/${towerId}`, { floors: 2 }, token)).status, 409);
    assert.equal((await call('PATCH', `/towers/${towerId}`, { floors: 121 }, token)).status, 400);
    assert.equal((await call('DELETE', `/towers/${towerId}`, undefined, token)).status, 409);
    const emptyTower = await call('POST', '/towers', { name: `${name}Empty`, floors: 1 }, token);
    assert.equal(emptyTower.status, 201);
    assert.equal((await call('DELETE', `/towers/${emptyTower.data.id}`, undefined, token)).status, 200);
    step('tower list, create, update, generation conflicts and protected delete');

    const flatList = await call('GET', `/flats?tower_id=${towerId}&search=${name}-101&page=1&limit=10`, undefined, token);
    assert.equal(flatList.status, 200, JSON.stringify(flatList));
    assert.equal(flatList.data.items[0].label, `${name}-101`);
    const manualFlat = await call('POST', '/flats', {
      tower_id: towerId,
      floor: 2,
      number: '998',
    }, token);
    assert.equal(manualFlat.status, 201, JSON.stringify(manualFlat));
    const flatId = manualFlat.data.id;
    assert.equal(manualFlat.data.label, `${name}-998`);
    const editedFlat = await call('PATCH', `/flats/${flatId}`, { number: '997' }, token);
    assert.equal(editedFlat.status, 200);
    assert.equal(editedFlat.data.label, `${name}-997`);
    assert.equal((await call('POST', '/flats', {
      tower_id: towerId,
      floor: 2,
      number: '997',
    }, token)).status, 409);
    assert.equal((await call('PATCH', `/flats/${flatId}`, { floor: 6 }, token)).status, 400);
    assert.equal((await call('PATCH', '/flats/not-a-uuid', { floor: 1 }, token)).status, 400);
    step('flat search, create, label recomputation and UUID validation');

    const headPhone = uniquePhone();
    const memberPhone = uniquePhone();
    const family = await call('POST', `/flats/${flatId}/family`, {
      members: [
        {
          full_name: 'Flow Family Head',
          phone: headPhone,
          resident_type: 'owner',
          relation_to_head: 'head',
          is_head: true,
          photo_path: 'residents/flow/head.jpg',
        },
        {
          full_name: 'Flow Family Member',
          phone: memberPhone,
          resident_type: 'family_member',
          relation_to_head: 'spouse',
        },
      ],
    }, token);
    assert.equal(family.status, 201, JSON.stringify(family));
    assert.equal(family.data.members.length, 2);
    assert.equal(family.data.members[1].receives_alerts, true);
    const [head, member] = family.data.members;
    const multipleHeads = await call('POST', `/flats/${flatId}/family`, {
      members: [
        { full_name: 'Head One', resident_type: 'owner', relation_to_head: 'head', is_head: true },
        { full_name: 'Head Two', resident_type: 'owner', relation_to_head: 'head', is_head: true },
      ],
    }, token);
    assert.equal(multipleHeads.status, 409);
    assert.match(multipleHeads.message, /Only one family member/);
    const duplicateFamilyPhone = await call('POST', `/flats/${flatId}/family`, {
      members: [
        { full_name: 'Duplicate One', phone: '9876543210', resident_type: 'owner', relation_to_head: 'head' },
        { full_name: 'Duplicate Two', phone: '+919876543210', resident_type: 'tenant', relation_to_head: 'other' },
      ],
    }, token);
    assert.equal(duplicateFamilyPhone.status, 409);
    assert.match(duplicateFamilyPhone.message, /\+919876543210/);
    const duplicateSocietyPhone = await call('POST', `/flats/${flatId}/family`, {
      members: [{ full_name: 'Already Registered', phone: headPhone, resident_type: 'tenant', relation_to_head: 'other' }],
    }, token);
    assert.equal(duplicateSocietyPhone.status, 409);
    const secondHead = await call('POST', `/flats/${flatId}/family`, {
      members: [{ full_name: 'Second Head', resident_type: 'owner', relation_to_head: 'head', is_head: true }],
    }, token);
    assert.equal(secondHead.status, 409);

    const residents = await call('GET', `/residents?flat_id=${flatId}&status=active&search=Flow&page=1&limit=10`, undefined, token);
    assert.equal(residents.status, 200);
    assert.ok(residents.data.items.some((item) => item.id === member.id));
    assert.equal((await call('GET', '/residents/not-a-uuid', undefined, token)).status, 400);
    assert.equal((await call('GET', `/residents/${'00000000-0000-4000-8000-000000000001'}`, undefined, token)).status, 404);
    assert.equal((await call('GET', '/residents?status=unknown', undefined, token)).status, 400);
    const details = await call('GET', `/residents/${member.id}`, undefined, token);
    assert.equal(details.status, 200);
    const promoted = await call('PATCH', `/residents/${member.id}`, {
      full_name: 'Flow Family Head Updated',
      is_head: true,
      relation_to_head: 'head',
      phone: memberPhone,
    }, token);
    assert.equal(promoted.status, 200, JSON.stringify(promoted));
    assert.equal(promoted.data.is_head, true);
    const demoted = await call('GET', `/residents/${head.id}`, undefined, token);
    assert.equal(demoted.data.is_head, false);
    assert.equal(demoted.data.relation_to_head, 'other');
    assert.equal((await call('PATCH', `/residents/${member.id}`, {
      phone: null,
      receives_alerts: true,
    }, token)).status, 400);
    assert.equal((await call('PATCH', `/residents/${member.id}`, {
      photo_path: 'https://example.test/photo.jpg',
    }, token)).status, 400);

    const movedOut = await call('POST', `/residents/${head.id}/move-out`, { note: 'Moved to another city' }, token);
    assert.equal(movedOut.status, 200, JSON.stringify(movedOut));
    assert.equal(movedOut.data.status, 'moved_out');
    assert.equal(movedOut.data.receives_alerts, false);
    assert.equal((await call('PATCH', `/residents/${head.id}`, { full_name: 'Not editable' }, token)).status, 409);
    assert.equal((await call('POST', `/residents/${head.id}/move-out`, {}, token)).status, 409);
    assert.equal((await call('DELETE', `/flats/${flatId}`, undefined, token)).status, 409);
    const disposableFlat = await call('POST', '/flats', {
      tower_id: towerId,
      floor: 1,
      number: '999',
    }, token);
    assert.equal(disposableFlat.status, 201);
    assert.equal((await call('DELETE', `/flats/${disposableFlat.data.id}`, undefined, token)).status, 200);
    step('family registration, duplicate/head rules, resident edit and move-out');

    const gateName = `Flow Gate ${String(Date.now()).slice(-6)}`;
    const gateResult = await call('POST', '/gates', { name: gateName }, token);
    assert.equal(gateResult.status, 201, JSON.stringify(gateResult));
    const gateId = gateResult.data.id;
    assert.equal((await call('POST', '/gates', { name: gateName }, token)).status, 409);
    const gates = await call('GET', '/gates?page=1&limit=20', undefined, token);
    assert.ok(gates.data.items.some((gate) => gate.id === gateId));
    assert.equal((await call('GET', '/gates?limit=101', undefined, token)).status, 400);
    assert.equal((await call('PATCH', `/gates/${gateId}`, { status: 'broken' }, token)).status, 400);
    const gateUpdate = await call('PATCH', `/gates/${gateId}`, { status: 'inactive' }, token);
    assert.equal(gateUpdate.status, 200);
    assert.equal(gateUpdate.data.status, 'inactive');
    step('gate create, list, duplicate and update');

    const joinerPhone = uniquePhone();
    const joiner = await login(joinerPhone);
    const joinBody = {
      invite_code: originalInviteCode,
      flat_label: `${name}-101`,
      full_name: 'Flow Join Request One',
      resident_type: 'family_member',
      relation_to_head: 'other',
    };
    const firstJoin = await call('POST', '/auth/resident/join', joinBody, joiner.access_token);
    assert.equal(firstJoin.status, 201, JSON.stringify(firstJoin));
    const pending = await call('GET', '/join-requests?status=pending&page=1&limit=100', undefined, token);
    assert.equal(pending.status, 200);
    const pendingRequest = pending.data.items.find((item) => item.full_name === joinBody.full_name);
    assert.ok(pendingRequest);
    assert.equal((await call('GET', '/join-requests?status=active', undefined, token)).status, 400);
    const approval = await call('POST', `/join-requests/${pendingRequest.id}/approve`, { is_head: true }, token);
    assert.equal(approval.status, 200, JSON.stringify(approval));
    assert.equal(approval.data.status, 'active');
    assert.equal(approval.data.receives_alerts, true);
    assert.equal((await call('POST', `/join-requests/${pendingRequest.id}/approve`, {}, token)).status, 409);

    const secondJoiner = await login(uniquePhone());
    const secondJoin = await call('POST', '/auth/resident/join', {
      ...joinBody,
      full_name: 'Flow Join Request Two',
    }, secondJoiner.access_token);
    assert.equal(secondJoin.status, 201, JSON.stringify(secondJoin));
    const pendingAgain = await call('GET', '/join-requests', undefined, token);
    const secondRequest = pendingAgain.data.items.find((item) => item.full_name === 'Flow Join Request Two');
    assert.ok(secondRequest);
    assert.equal((await call('POST', `/join-requests/${secondRequest.id}/approve`, { is_head: true }, token)).status, 409);
    assert.equal((await call('POST', `/join-requests/${secondRequest.id}/decline`, {}, token)).status, 400);
    const declined = await call('POST', `/join-requests/${secondRequest.id}/decline`, { reason: 'Unable to verify details' }, token);
    assert.equal(declined.status, 200, JSON.stringify(declined));
    assert.equal(declined.data.status, 'declined');
    assert.equal((await call('POST', `/join-requests/${secondRequest.id}/decline`, { reason: 'Again' }, token)).status, 409);
    const declinedList = await call('GET', '/join-requests?status=declined', undefined, token);
    assert.ok(declinedList.data.items.some((item) => item.id === secondRequest.id));
    step('join-request list, approve, duplicate head, decline and repeat handling');

    const residentLogin = await login('9000000003');
    assert.equal((await call('GET', '/towers', undefined, residentLogin.access_token)).status, 403);
    step('non-admin cannot access society-admin routes');

    // Find or create a second-society tower to prove cross-society ids are hidden.
    let otherAdmin = await login('9811111111');
    let otherProfile = otherAdmin.profiles?.find(
      (profile) => profile.role === 'admin' && profile.society_id !== societyId,
    );
    if (!otherProfile) {
      otherAdmin = await login(uniquePhone());
      const registered = await call('POST', '/auth/admin/register-society', {
        society_name: `Isolation ${Date.now()}`,
        admin_name: 'Isolation Test Admin',
      }, otherAdmin.access_token);
      assert.equal(registered.status, 201, JSON.stringify(registered));
      otherAdmin = registered.data;
      otherProfile = otherAdmin.active_profile;
    } else {
      const switched = await call('POST', '/auth/switch-role', {
        role: 'admin',
        society_id: otherProfile.society_id,
      }, otherAdmin.access_token);
      assert.equal(switched.status, 200, JSON.stringify(switched));
      otherAdmin = switched.data;
    }
    const otherTowers = await call('GET', '/towers', undefined, otherAdmin.access_token);
    let foreignTower = otherTowers.data.items[0];
    if (!foreignTower) {
      const createdForeign = await call('POST', '/towers', { name: `Foreign${Date.now()}`, floors: 1 }, otherAdmin.access_token);
      assert.equal(createdForeign.status, 201, JSON.stringify(createdForeign));
      foreignTower = createdForeign.data;
    }
    assert.equal((await call('PATCH', `/towers/${foreignTower.id}`, { floors: 1 }, token)).status, 404);
    const foreignFlat = await call('POST', '/flats', {
      tower_id: foreignTower.id,
      floor: 1,
      number: '101',
    }, otherAdmin.access_token);
    assert.equal(foreignFlat.status, 201, JSON.stringify(foreignFlat));
    assert.equal((await call('GET', `/flats?tower_id=${foreignTower.id}`, undefined, token)).status, 404);
    assert.equal((await call('PATCH', `/flats/${foreignFlat.data.id}`, { number: '102' }, token)).status, 404);

    const foreignGate = await call('POST', '/gates', {
      name: `Foreign Gate ${String(Date.now()).slice(-6)}`,
    }, otherAdmin.access_token);
    assert.equal(foreignGate.status, 201, JSON.stringify(foreignGate));
    assert.equal((await call('PATCH', `/gates/${foreignGate.data.id}`, { status: 'inactive' }, token)).status, 404);

    const foreignFamily = await call('POST', `/flats/${foreignFlat.data.id}/family`, {
      members: [{
        full_name: 'Foreign Society Resident',
        resident_type: 'owner',
        relation_to_head: 'other',
      }],
    }, otherAdmin.access_token);
    assert.equal(foreignFamily.status, 201, JSON.stringify(foreignFamily));
    const foreignResidentId = foreignFamily.data[0].id;
    assert.equal((await call('GET', `/residents/${foreignResidentId}`, undefined, token)).status, 404);
    assert.equal((await call('PATCH', `/residents/${foreignResidentId}`, { full_name: 'Changed' }, token)).status, 404);
    assert.equal((await call('POST', `/residents/${foreignResidentId}/move-out`, {}, token)).status, 404);

    const otherSociety = await call('GET', '/society', undefined, otherAdmin.access_token);
    assert.equal(otherSociety.status, 200, JSON.stringify(otherSociety));
    const foreignJoiner = await login(uniquePhone());
    const foreignJoin = await call('POST', '/auth/resident/join', {
      invite_code: otherSociety.data.invite_code,
      flat_label: foreignFlat.data.label,
      full_name: 'Foreign Join Request',
      resident_type: 'tenant',
      relation_to_head: 'other',
    }, foreignJoiner.access_token);
    assert.equal(foreignJoin.status, 201, JSON.stringify(foreignJoin));
    const foreignJoinRequestId = foreignJoin.data.active_profile.profile_id;
    assert.equal((await call('POST', `/join-requests/${foreignJoinRequestId}/approve`, {}, token)).status, 404);
    assert.equal((await call('POST', `/join-requests/${foreignJoinRequestId}/decline`, {
      reason: 'Wrong society',
    }, token)).status, 404);
    step('cross-society tower, flat, gate, resident and join-request ids return 404');

    const rotated = await call('POST', '/society/invite-code/rotate', {}, token);
    assert.equal(rotated.status, 200, JSON.stringify(rotated));
    assert.match(rotated.data.invite_code, /^[A-Z]{3}-\d{4}$/);
    step('invite-code rotation');

    console.log('\nALL ADMIN TESTS PASSED');
  } catch (error) {
    console.error('\nFAILED:', error.message);
    process.exitCode = 1;
  } finally {
    if (societyId && originalInviteCode) {
      await pool.query('update societies set invite_code = $1 where id = $2', [
        originalInviteCode,
        societyId,
      ]).catch((error) => console.error('Could not restore the development invite code:', error.message));
    }
    server.close();
    await pool.end();
  }
})();
