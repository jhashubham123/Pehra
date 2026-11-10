const { z } = require('zod');

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);

exports.list = z.object({ page, limit });

exports.update = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  address_line: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(80).nullable().optional(),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits').nullable().optional(),
  approval_wait_seconds: z.number().int().min(15).max(600).optional(),
  overstay_minutes: z.number().int().min(5).max(1440).optional(),
  photo_retention_days: z.number().int().min(7).max(365).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one society field to update.');
