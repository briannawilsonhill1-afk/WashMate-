import { z } from 'zod';
import { insertOrderSchema, insertWasherProfileSchema, profileUpdateSchema, orders, washerProfiles, users, SENSITIVE_FIELD_MASK } from './schema';

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
  taxId: typeof SENSITIVE_FIELD_MASK;
  routingNumber: typeof SENSITIVE_FIELD_MASK;
  accountNumber: typeof SENSITIVE_FIELD_MASK;
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
        status: z.enum(['pending', 'accepted', 'in_progress', 'completed']).optional()
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
      input: z.object({ status: z.enum(['pending', 'accepted', 'in_progress', 'completed']) }),
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
    }
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
