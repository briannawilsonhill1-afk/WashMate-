import { z } from 'zod';

export const SENSITIVE_FIELD_MASK = 'WASHMATE_MASKED' as const;

export interface User {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role?: 'customer' | 'washer' | null;
  address?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export type PublicUser = User;

export interface Order {
  id: number;
  customerId: string;
  washerId?: string | null;
  status: 'pending' | 'accepted' | 'picked_up' | 'in_progress' | 'out_for_delivery' | 'completed';
  loadSize: 'small' | 'medium' | 'large';
  flatFee: number;
  extraFolding: boolean;
  hasPetHair: boolean;
  heavilySoiled: boolean;
  soilNotes?: string | null;
  soapPreference: 'customer_provided' | 'washer_provided';
  pickupFee: number;
  soiledFee: number;
  totalFee: number;
  pickupAddress?: string | null;
  recurringInterval: 'none' | 'weekly' | 'biweekly' | 'monthly';
  createdAt?: Date | string | null;
}

export type OrderSafeResponse = Omit<Order, 'pickupAddress'>;
export type PendingOrderResponse = Pick<Order, 'id' | 'status' | 'loadSize' | 'flatFee' | 'extraFolding' | 'hasPetHair' | 'heavilySoiled' | 'soapPreference' | 'pickupFee' | 'soiledFee' | 'totalFee' | 'washerId'> & {
  pickupArea?: string | null;
};

export interface WasherProfile {
  id: number;
  userId: string;
  legalName: string;
  dateOfBirth: string;
  phone: string;
  taxId: string | null;
  businessName?: string | null;
  bankName: string | null;
  accountHolderName: string | null;
  routingNumber: string | null;
  accountNumber: string | null;
  accountType: 'checking' | 'savings';
  stripeCustomerId?: string | null;
  stripeBankAccountId?: string | null;
  verifiedBankName?: string | null;
  verifiedAccountLast4?: string | null;
  stripeVerifiedAt?: Date | string | null;
  agreedToTerms: boolean;
  county?: string | null;
  state?: string | null;
  bgCheckConsent: boolean;
  bgSelfCertify: boolean;
  bgCheckStatus: 'not_started' | 'pending' | 'cleared' | 'flagged' | 'provider_failed';
  bgCheckDate?: Date | string | null;
  updatedAt?: Date | string | null;
}

export type WasherProfileResponse = Omit<WasherProfile, 'taxId' | 'routingNumber' | 'accountNumber'> & {
  taxId: typeof SENSITIVE_FIELD_MASK | null;
  routingNumber: typeof SENSITIVE_FIELD_MASK | null;
  accountNumber: typeof SENSITIVE_FIELD_MASK | null;
};

export type WasherBgCheckStatusResponse = Pick<WasherProfile, 'bgCheckStatus'>;

const insertOrderSchema = z.object({
  loadSize: z.enum(['small', 'medium', 'large']),
  extraFolding: z.boolean().optional(),
  hasPetHair: z.boolean().optional(),
  heavilySoiled: z.boolean().optional(),
  soilNotes: z.string().optional(),
  soapPreference: z.enum(['customer_provided', 'washer_provided']).optional(),
  recurringInterval: z.enum(['none', 'weekly', 'biweekly', 'monthly']).optional(),
});

export type OrderInput = z.infer<typeof insertOrderSchema>;

const insertWasherProfileSchema = z.object({
  legalName: z.string(),
  dateOfBirth: z.string(),
  phone: z.string(),
  taxId: z.string(),
  businessName: z.string().optional().nullable(),
  // Manual bank fields are optional — washers can verify via Stripe FC instead.
  bankName: z.string().optional().nullable(),
  accountHolderName: z.string().optional().nullable(),
  routingNumber: z.string().optional().nullable(),
  accountNumber: z.string().optional().nullable(),
  accountType: z.enum(['checking', 'savings']).optional(),
  agreedToTerms: z.boolean().optional(),
  county: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  bgCheckConsent: z.boolean().optional(),
  bgSelfCertify: z.boolean().optional(),
});

export const errorSchemas = {
  validation: z.object({ message: z.string(), field: z.string().optional() }),
  notFound: z.object({ message: z.string() }),
  internal: z.object({ message: z.string() }),
};

const orderSafeResponseSchema = z.object({
  id: z.number(),
  customerId: z.string(),
  washerId: z.string().nullable().optional(),
  status: z.enum(['pending', 'accepted', 'picked_up', 'in_progress', 'out_for_delivery', 'completed']),
  loadSize: z.enum(['small', 'medium', 'large']),
  flatFee: z.number(),
  extraFolding: z.boolean(),
  hasPetHair: z.boolean(),
  heavilySoiled: z.boolean(),
  soilNotes: z.string().nullable().optional(),
  soapPreference: z.enum(['customer_provided', 'washer_provided']),
  pickupFee: z.number(),
  soiledFee: z.number(),
  totalFee: z.number(),
  recurringInterval: z.enum(['none', 'weekly', 'biweekly', 'monthly']),
  createdAt: z.union([z.date(), z.string()]).nullable().optional(),
});

export const api = {
  profile: {
    update: {
      method: 'POST' as const,
      path: '/api/me/profile' as const,
      input: z.object({ role: z.enum(['customer', 'washer']), address: z.string().min(5) }),
      responses: {
        200: z.custom<PublicUser>(),
        400: errorSchemas.validation,
      }
    }
  },
  orders: {
    list: {
      method: 'GET' as const,
      path: '/api/orders' as const,
      input: z.object({ status: z.enum(['pending', 'accepted', 'picked_up', 'in_progress', 'out_for_delivery', 'completed']).optional() }).optional(),
      responses: {
        200: z.array(z.custom<OrderSafeResponse | PendingOrderResponse>())
      }
    },
    create: {
      method: 'POST' as const,
      path: '/api/orders' as const,
      input: insertOrderSchema,
      responses: {
        201: orderSafeResponseSchema,
        400: errorSchemas.validation,
      }
    },
    claim: {
      method: 'PATCH' as const,
      path: '/api/orders/:id/claim' as const,
      input: z.object({}).optional(),
      responses: {
        200: orderSafeResponseSchema,
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
        200: orderSafeResponseSchema,
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
      responses: {
        200: z.object({ clientSecret: z.string(), publishableKey: z.string() }),
      }
    },
    fcComplete: {
      method: 'POST' as const,
      path: '/api/washer-profile/financial-connections/complete' as const,
      input: z.object({ sessionId: z.string() }),
      responses: {
        200: z.custom<WasherProfileResponse>(),
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
      responses: {
        201: z.object({
          id: z.number(),
          amountCents: z.number().int(),
          orderCount: z.number().int(),
          status: z.enum(['pending', 'paid', 'failed']),
        }),
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

export type OrderInputType = z.infer<typeof insertOrderSchema>;
export type InsertWasherProfile = z.infer<typeof insertWasherProfileSchema>;
