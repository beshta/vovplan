import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(2, 'Название должно быть не менее 2 символов').max(100),
  description: z.string().max(1000).optional(),
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  bounds: z.object({
    north: z.number(),
    south: z.number(),
    east: z.number(),
    west: z.number(),
  }),
});

export const updateProjectSchema = createProjectSchema.partial();

export const inviteMemberSchema = z.object({
  email: z.string().email('Некорректный email'),
  role: z.enum(['DESIGNER', 'SUPER_SPECTATOR', 'SPECTATOR', 'EXTERNAL_SPECTATOR']),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
