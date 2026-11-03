// Works out which roles a person has. One phone can be a resident in one society and
// an admin in another, so a user can have several "profiles".
const { query } = require('../db/query');
const { PROFILE_PRIORITY } = require('../config/constants');

// An admin adds guards/admins/residents by phone BEFORE they ever log in. At first login we
// match the verified phone and attach the person's user id to those rows.
async function linkPhoneToProfiles(userId, phone) {
  await query(
    `update society_staff
        set user_id = $1, status = case when status = 'invited' then 'active' else status end
      where phone = $2 and status in ('invited', 'active') and (user_id is null or status = 'invited')`,
    [userId, phone]
  );
  await query(
    `update residents set user_id = $1
      where phone = $2 and user_id is null and status in ('pending', 'active')`,
    [userId, phone]
  );
}

async function loadProfiles(userId) {
  const staff = await query(
    `select ss.id as profile_id, ss.role, ss.status, ss.full_name, ss.shift,
            ss.society_id, s.name as society_name,
            gd.gate_id, g.name as gate_name
       from society_staff ss
       join societies s on s.id = ss.society_id and s.status = 'active' and s.deleted_at is null
       left join lateral (
              select gate_id from gate_devices
               where staff_id = ss.id and status = 'active'
               order by paired_at desc limit 1) gd on true
       left join gates g on g.id = gd.gate_id
      where ss.user_id = $1 and ss.status = 'active'`,
    [userId]
  );

  const residents = await query(
    `select r.id as profile_id, 'resident' as role, r.status, r.full_name,
            r.society_id, s.name as society_name,
            r.flat_id, f.label as flat_label, r.is_head, r.decision_note
       from residents r
       join societies s on s.id = r.society_id and s.status = 'active' and s.deleted_at is null
       join flats f on f.id = r.flat_id and f.society_id = r.society_id
      where r.user_id = $1 and r.status in ('pending', 'active', 'declined')`,
    [userId]
  );

  const rank = (p) => {
    const base = PROFILE_PRIORITY.indexOf(p.role) * 10;
    return base + (p.status === 'active' ? 0 : p.status === 'pending' ? 1 : 2);
  };
  return [...staff.rows, ...residents.rows].sort((a, b) => rank(a) - rank(b));
}

const pickDefault = (profiles) => profiles[0] || null;

function findProfile(profiles, role, societyId) {
  return profiles.find((p) => p.role === role && p.society_id === societyId) || null;
}

module.exports = { linkPhoneToProfiles, loadProfiles, pickDefault, findProfile };
