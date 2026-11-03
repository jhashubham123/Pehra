// Rules for what each auth request may contain.
const { z } = require('zod');
const { normalizePhone } = require('../utils/phone');
const { RESIDENT_TYPES, RELATIONS } = require('../config/constants');

const phone = z.string({ error: 'Phone number is required' }).transform((value, ctx) => {
  const normalized = normalizePhone(value);
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number' });
    return z.NEVER;
  }
  return normalized;
});

const text = (label, max = 100) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);

exports.otpRequest = z.object({ phone });

exports.otpVerify = z.object({
  phone,
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

exports.refresh = z.object({
  refresh_token: z.string().min(10, 'refresh_token is required'),
  role: z.enum(['admin', 'guard', 'resident']).optional(),
  society_id: z.string().uuid().optional(),
});

exports.logout = z.object({ refresh_token: z.string().min(10, 'refresh_token is required') });

exports.switchRole = z.object({
  role: z.enum(['admin', 'guard', 'resident']),
  society_id: z.string().uuid('society_id must be a valid id'),
});

exports.residentJoin = z.object({
  invite_code: text('Society code', 20).transform((v) => v.toUpperCase()),
  flat_label: text('Flat', 20).transform((v) => v.toUpperCase()), // e.g. B-402
  full_name: text('Name'),
  resident_type: z.enum(RESIDENT_TYPES),
  relation_to_head: z.enum(RELATIONS).optional(),
});

exports.registerSociety = z.object({
  society_name: text('Society name', 120),
  admin_name: text('Your name'),
  address_line: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits').optional(),
});

exports.createPairingCode = z.object({
  gate_id: z.string().uuid('gate_id must be a valid id'),
  staff_id: z.string().uuid().optional(), // optional: make the code usable by one guard only
});

exports.pairDevice = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  platform: z.enum(['android', 'ios']),
  push_token: z.string().min(8, 'push_token is required').max(500),
  device_label: z.string().trim().max(60).optional(),
});
