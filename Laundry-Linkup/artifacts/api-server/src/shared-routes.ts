import { z } from 'zod';
import { insertOrderSchema, insertWasherProfileSchema, profileUpdateSchema, orders, washerProfiles, users, SENSITIVE_FIELD_MASK } from '@workspace/db';

export const errorSchemas = {
  validation: z.object({ message: z.string(), field: z.string().optional() }),
  notFound: z.object({ message: z.string() }),
  internal: z.object({ message: z.string() }),
};

type FullOrder = typeof orders.$inferSelect;
export type OrderSafeResponse = Omit<FullOrder, 'pickupAddress'>;
export type PendingOrderResponse = Pick<FullOrder, 'id' | 'status' | 'loadSize' | 'flatFee' | 'extraFolding' | 'hasPetHair' | 'heavilySoiled' | 'soapPreference' | 'pickupFee' | 'soiledFee' | 'totalFee' | 'washerId'>;

type FullWasherProfile = typeof washerProfiles.$inferSelect;
export type WasherProfileResponse = Omit<FullWasherProfile, 'taxId' | 'routingNumber' | 'accountNumber'> & {
  taxId: typeof SENSITIVE_FIELD_MASK | null;
  routingNumber: typeof SENSITIVE_FIELD_MASK | null;
  accountNumber: typeof SENSITIVE_FIELD_MASK | null;
};
export type WasherBgCheckStatusResponse = Pick<FullWasherProfile, 'bgCheckStatus'>;

export const api = {
  profile: {
    update: {
      method: 'POST' as const,
      path: '/api/me/profile' as const,
      input: profileUpdateSchema,
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        400: errorSchemas.validation,
      }
    }
  },
  orders: {
    list: {
      method: 'GET' as const,
      path: '/api/orders' as const,
      input: z.object({
        status: z.enum(['pending', 'accepted', 'picked_up', 'in_progress', 'out_for_delivery', 'completed']).optional()
      }).optional(),
      responses: {
        200: z.array(z.custom<OrderSafeResponse | PendingOrderResponse>())
      }
    },
    create: {
      method: 'POST' as const,
      path: '/api/orders' as const,
      input: insertOrderSchema.extend({
        recurringInterval: z.enum(['none', 'weekly', 'biweekly', 'monthly']).optional()
      }),
      responses: {
        201: z.custom<OrderSafeResponse>(),
        400: errorSchemas.validation,
      }
    },
    claim: {
      method: 'PATCH' as const,
      path: '/api/orders/:id/claim' as const,
      input: z.object({}).optional(),
      responses: {
        200: z.custom<OrderSafeResponse>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      }
    },
    customerAddress: {
      method: 'GET' as const,
      path: '/api/orders/:id/customer-address' as const,
      responses: {
        200: z.object({ address: z.string() }),
        403: errorSchemas.validation,
        404: errorSchemas.notFound,
      }
    },
    updateStatus: {
      method: 'PATCH' as const,
      path: '/api/orders/:id/status' as const,
      input: z.object({ status: z.enum(['pending', 'accepted', 'picked_up', 'in_progress', 'out_for_delivery', 'completed']) }),
      responses: {
        200: z.custom<OrderSafeResponse>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      }
    }
  },
  washerProfile: {
    get: {
      method: 'GET' as const,
      path: '/api/washer-profile' as const,
      responses: {
        200: z.custom<WasherProfileResponse>(),
        404: errorSchemas.notFound,
      }
    },
    status: {
      method: 'GET' as const,
      path: '/api/washer-profile/status' as const,
      responses: {
        200: z.custom<WasherBgCheckStatusResponse>(),
        404: errorSchemas.notFound,
      }
    },
    upsert: {
      method: 'POST' as const,
      path: '/api/washer-profile' as const,
      input: insertWasherProfileSchema,
      responses: {
        200: z.custom<WasherProfileResponse>(),
        400: errorSchemas.validation,
      }
    },
    fcSession: {
      method: 'POST' as const,
      path: '/api/washer-profile/financial-connections/session' as const,
      input: z.object({}).optional(),
      responses: {
        200: z.object({ clientSecret: z.string(), publishableKey: z.string() }),
        400: errorSchemas.validation,
      }
    },
    fcComplete: {
      method: 'POST' as const,
      path: '/api/washer-profile/financial-connections/complete' as const,
      input: z.object({ sessionId: z.string().min(1) }),
      responses: {
        200: z.custom<WasherProfileResponse>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      }
    },
    earnings: {
      method: 'GET' as const,
      path: '/api/washer-profile/earnings' as const,
      responses: {
        200: z.object({
          unpaidEarningsCents: z.number().int(),
          unpaidPlatformFeeCents: z.number().int(),
          unpaidOrderCount: z.number().int(),
          hasVerifiedBank: z.boolean(),
          verifiedBankName: z.string().nullable(),
          verifiedAccountLast4: z.string().nullable(),
          payouts: z.array(z.object({
            id: z.number(),
            amountCents: z.number().int(),
            platformFeeCents: z.number().int(),
            totalFeeCents: z.number().int(),
            orderCount: z.number().int(),
            status: z.enum(['pending', 'paid', 'failed']),
            verifiedBankName: z.string().nullable(),
            verifiedAccountLast4: z.string().nullable(),
            failureReason: z.string().nullable(),
            createdAt: z.union([z.date(), z.string()]),
            paidAt: z.union([z.date(), z.string()]).nullable(),
          })),
        }),
      }
    },
    requestPayout: {
      method: 'POST' as const,
      path: '/api/washer-profile/payouts' as const,
      input: z.object({}).optional(),
      responses: {
        201: z.object({
          id: z.number(),
          amountCents: z.number().int(),
          orderCount: z.number().int(),
          status: z.enum(['pending', 'paid', 'failed']),
        }),
        400: errorSchemas.validation,
      }
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type OrderInput = z.infer<typeof api.orders.create.input>;
export type OrderResponse = z.infer<typeof api.orders.create.responses[201]>;
export type OrdersListResponse = z.infer<typeof api.orders.list.responses[200]>;
