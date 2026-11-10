const { z } = require('zod');
const { normalizePhone } = require('../utils/phone');
const { RESIDENT_TYPES, RELATIONS } = require('../config/constants');

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const id = z.string().trim().uuid('id must be a valid id');
const enumText = (values) => z.string().trim().pipe(z.enum(values));

function phoneValue(value, ctx) {
  if (value === null || value === undefined) return value;
  const normalized = normalizePhone(value);
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number in E.164 format.' });
    return z.NEVER;
  }
  return normalized;
}

const optionalPhone = z.union([z.string().trim(), z.null()]).optional().transform(phoneValue);
const photoPath = z.union([
  z.string().trim().max(300, 'photo_path must be 300 characters or fewer'),
  z.null(),
]).optional().refine(
  (value) => value == null || !/^[a-z][a-z\d+.-]*:/i.test(value),
  'photo_path must be a storage object key, not a URL.'
);
const residentType = enumText(RESIDENT_TYPES);
const relation = enumText(RELATIONS);

const member = z.object({
  full_name: z.string().trim().min(1, 'Name is required').max(120),
  phone: optionalPhone,
  resident_type: residentType,
  relation_to_head: relation,
  is_head: z.boolean().optional(),
  receives_alerts: z.boolean().optional(),
  photo_path: photoPath,
}).superRefine((value, ctx) => {
  if (value.is_head && value.relation_to_head !== 'head') {
    ctx.addIssue({ code: 'custom', path: ['relation_to_head'], message: 'A head must have relation_to_head set to head.' });
  }
  if (value.receives_alerts && !value.phone) {
    ctx.addIssue({ code: 'custom', path: ['phone'], message: 'A phone number is required to receive alerts.' });
  }
});

exports.idParams = z.object({ id });
exports.list = z.object({
  flat_id: z.string().trim().uuid('flat_id must be a valid id').optional(),
  status: enumText(['pending', 'active', 'declined', 'moved_out']).default('active'),
  search: z.string().trim().max(100).optional(),
  page,
  limit,
});
exports.update = z.object({
  full_name: z.string().trim().min(1, 'Name is required').max(120).optional(),
  phone: optionalPhone,
  photo_path: photoPath,
  resident_type: residentType.optional(),
  relation_to_head: relation.optional(),
  receives_alerts: z.boolean().optional(),
  is_head: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one resident field to update.')
  .superRefine((value, ctx) => {
    if (value.is_head === true && value.relation_to_head !== undefined && value.relation_to_head !== 'head') {
      ctx.addIssue({ code: 'custom', path: ['relation_to_head'], message: 'A head must have relation_to_head set to head.' });
    }
    if (value.is_head === false && value.relation_to_head === 'head') {
      ctx.addIssue({ code: 'custom', path: ['relation_to_head'], message: 'A non-head cannot have relation_to_head set to head.' });
    }
  });
exports.moveOut = z.object({
  note: z.string().trim().max(200).optional(),
});
exports.family = z.object({
  members: z.array(member).min(1).max(15),
});
exports.joinRequestList = z.object({
  status: enumText(['pending', 'declined']).default('pending'),
  page,
  limit,
});
exports.approve = z.object({
  is_head: z.boolean().optional(),
  relation_to_head: relation.optional(),
  receives_alerts: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (value.is_head === true && value.relation_to_head !== undefined && value.relation_to_head !== 'head') {
    ctx.addIssue({ code: 'custom', path: ['relation_to_head'], message: 'A head must have relation_to_head set to head.' });
  }
  if (value.is_head === false && value.relation_to_head === 'head') {
    ctx.addIssue({ code: 'custom', path: ['relation_to_head'], message: 'A non-head cannot have relation_to_head set to head.' });
  }
});
exports.decline = z.object({
  reason: z.string().trim().min(1, 'A reason is required').max(200, 'Reason must be 200 characters or fewer'),
});
