// Fixed values used across the app.
module.exports = {
  ROLES: { ADMIN: 'admin', GUARD: 'guard', RESIDENT: 'resident', USER: 'user' },
  // 'user' = logged in but has no society role yet (new person)

  // order used to choose which profile to open by default after login
  PROFILE_PRIORITY: ['admin', 'guard', 'resident'],

  RESIDENT_TYPES: ['owner', 'tenant', 'family_member'],
  RELATIONS: ['head', 'spouse', 'son', 'daughter', 'parent', 'sibling', 'other'],
};
