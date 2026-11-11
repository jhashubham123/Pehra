const { z } = require('zod');
const { normalizePhone } = require('../utils/phone');

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const id = z.string().trim().uuid('id must be a valid id');
const statuses = ['invited', 'active', 'suspended', 'removed'];
const photoPath = z.union([
  z.string().trim().max(300, 'photo_path must be 300 characters or fewer'),
  z.null(),
]).optional().refine(
  (value) => value == null || !/^[a-z][a-z\d+.-]*:/i.test(value),
  'photo_path must be a storage object key, not a URL.'
);

function phoneValue(value, ctx) {
  const normalized = normalizePhone(value);
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number.' });
    return z.NEVER;
  }
  return normalized;
}

const phone = z.string().trim().transform(phoneValue);
const staffFields = {
  full_name: z.string().trim().min(1, 'Name is required').max(120),
  phone,
  photo_path: photoPath,
};

exports.idParams = z.object({ id });
exports.create = z.object({
  ...staffFields,
  role: z.enum(['guard', 'admin']).default('guard'),
  shift: z.enum(['day', 'night', 'general']).optional(),
}).superRefine((value, ctx) => {
  if (value.role === 'guard' && !value.shift) {
    ctx.addIssue({ code: 'custom', path: ['shift'], message: 'Shift is required for a guard.' });
  }
  if (value.role === 'admin' && value.shift !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['shift'], message: 'Shift must be omitted for an admin.' });
  }
});

exports.list = z.object({
  role: z.enum(['guard', 'admin']).optional(),
  status: z.preprocess(
    (value) => typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean) : value,
    z.array(z.enum(statuses)).min(1).default(['invited', 'active', 'suspended'])
  ),
  search: z.string().trim().max(100).optional(),
  page,
  limit,
});

exports.update = z.object({
  full_name: staffFields.full_name.optional(),
  shift: z.enum(['day', 'night', 'general']).optional(),
  photo_path: photoPath,
  phone: phone.optional(),
  status: z.enum(['active', 'suspended']).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one staff field to update.');

exports.gateDeviceList = z.object({
  status: z.enum(['active', 'revoked']).default('active'),
  gate_id: id.optional(),
});
