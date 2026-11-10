const { z } = require('zod');

const id = z.string().trim().uuid('id must be a valid id');
const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const name = z.string().trim().min(1, 'Name is required').max(120);
const number = z.string().trim().min(1, 'Number is required').max(30);
const gateStatus = z.string().trim().pipe(z.enum(['active', 'inactive']));

exports.idParams = z.object({ id });
exports.flatParams = z.object({ flatId: z.string().trim().uuid('flatId must be a valid id') });

exports.towerList = z.object({ page, limit });
exports.towerCreate = z.object({
  name,
  floors: z.number().int().min(1).max(120),
});
exports.towerUpdate = z.object({
  name: name.optional(),
  floors: z.number().int().min(1).max(120).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide a tower name or floor count.');
exports.generateFlats = z.object({
  floors_to: z.number().int().min(1).max(120),
  flats_per_floor: z.number().int().min(1).max(30),
});

exports.flatList = z.object({
  tower_id: z.string().trim().uuid('tower_id must be a valid id').optional(),
  search: z.string().trim().max(100).optional(),
  page,
  limit,
});
exports.flatCreate = z.object({
  tower_id: z.string().trim().uuid('tower_id must be a valid id'),
  floor: z.number().int().min(0),
  number,
});
exports.flatUpdate = z.object({
  floor: z.number().int().min(0).optional(),
  number: number.optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide a floor or number.');

exports.gateList = z.object({ page, limit });
exports.gateCreate = z.object({ name });
exports.gateUpdate = z.object({
  name: name.optional(),
  status: gateStatus.optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide a gate name or status.');
