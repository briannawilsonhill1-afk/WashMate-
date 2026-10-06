import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  CUSTOMER_UNLOCK_AMOUNT_CENTS,
  CUSTOMER_UNLOCK_PURPOSE,
  CustomerUnlockService,
  type CustomerUnlockRepository,
  type CustomerUnlockStripe,
  type UnlockUser,
} from "./customerUnlock";

function user(overrides: Partial<UnlockUser> = {}): UnlockUser {
  return {
    id: "user_customer",
    role: "customer",
    email: "customer@example.com",
    customerStripeCustomerId: null,
    customerUnlockPaymentIntentId: null,
    customerUnlockedAt: null,
    ...overrides,
  };
}

function intent(
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.PaymentIntent {
  return {
    id: "pi_unlock",
    object: "payment_intent",
    amount: CUSTOMER_UNLOCK_AMOUNT_CENTS,
    currency: "usd",
    customer: "cus_unlock",
    metadata: {
      washmateUserId: "user_customer",
      purpose: CUSTOMER_UNLOCK_PURPOSE,
    },
    status: "requires_payment_method",
    client_secret: "pi_secret",
    ...overrides,
  } as Stripe.PaymentIntent;
}

class FakeRepository implements CustomerUnlockRepository {
  current: UnlockUser;
  private tail: Promise<void> = Promise.resolve();

  constructor(initial: UnlockUser) {
    this.current = initial;
  }

  async get(): Promise<UnlockUser> {
    return { ...this.current };
  }

  async withLock<T>(
    _userId: string,
    callback: Parameters<CustomerUnlockRepository["withLock"]>[1],
  ): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback(
        { ...this.current },
        async (values) => {
          this.current = { ...this.current, ...values };
          return { ...this.current };
        },
      ) as T;
    } finally {
      release();
    }
  }

  async markUnlocked(
    _userId: string,
    paymentIntentId: string,
  ): Promise<boolean> {
    if (this.current.customerUnlockPaymentIntentId !== paymentIntentId) {
      return false;
    }
    this.current = { ...this.current, customerUnlockedAt: new Date() };
    return true;
  }
}

function stripeFake(paymentIntent: Stripe.PaymentIntent) {
  let customerCreates = 0;
  let intentCreates = 0;
  const stripe: CustomerUnlockStripe = {
    customers: {
      async create() {
        customerCreates += 1;
        return { id: "cus_unlock" } as Stripe.Customer;
      },
    },
    paymentIntents: {
      async create() {
        intentCreates += 1;
        return paymentIntent;
      },
      async retrieve() {
        return paymentIntent;
      },
    },
  };
  return {
    stripe,
    counts: () => ({ customerCreates, intentCreates }),
  };
}

describe("CustomerUnlockService", () => {
  it("reports an unpaid customer without creating a payment", async () => {
    const repository = new FakeRepository(user());
    const fake = stripeFake(intent());
    const service = new CustomerUnlockService(repository, fake.stripe);

    await expect(service.status("user_customer")).resolves.toBe(false);
    expect(fake.counts()).toEqual({ customerCreates: 0, intentCreates: 0 });
  });

  it("reuses a pending intent on retries", async () => {
    const repository = new FakeRepository(user({
      customerStripeCustomerId: "cus_unlock",
      customerUnlockPaymentIntentId: "pi_unlock",
    }));
    const fake = stripeFake(intent());
    const service = new CustomerUnlockService(repository, fake.stripe);

    await expect(service.payment("user_customer")).resolves.toEqual({
      clientSecret: "pi_secret",
    });
    await expect(service.payment("user_customer")).resolves.toEqual({
      clientSecret: "pi_secret",
    });
    expect(fake.counts().intentCreates).toBe(0);
  });

  it("serializes concurrent first-payment requests and creates one intent", async () => {
    const repository = new FakeRepository(user());
    const fake = stripeFake(intent());
    const service = new CustomerUnlockService(repository, fake.stripe);

    const results = await Promise.all([
      service.payment("user_customer"),
      service.payment("user_customer"),
      service.payment("user_customer"),
    ]);

    expect(results).toEqual([
      { clientSecret: "pi_secret" },
      { clientSecret: "pi_secret" },
      { clientSecret: "pi_secret" },
    ]);
    expect(fake.counts()).toEqual({ customerCreates: 1, intentCreates: 1 });
  });

  it("persists success found during status reconciliation", async () => {
    const repository = new FakeRepository(user({
      customerStripeCustomerId: "cus_unlock",
      customerUnlockPaymentIntentId: "pi_unlock",
    }));
    const fake = stripeFake(intent({ status: "succeeded" }));
    const service = new CustomerUnlockService(repository, fake.stripe);

    await expect(service.status("user_customer")).resolves.toBe(true);
    expect(repository.current.customerUnlockedAt).toBeInstanceOf(Date);
    await expect(service.confirm("user_customer")).resolves.toEqual({
      unlocked: true,
    });
  });

  it.each([
    ["owner", { customer: "cus_someone_else" }],
    ["amount", { amount: 1 }],
  ])("rejects an intent with the wrong %s", async (_label, override) => {
    const repository = new FakeRepository(user({
      customerStripeCustomerId: "cus_unlock",
      customerUnlockPaymentIntentId: "pi_unlock",
    }));
    const fake = stripeFake(intent(override as Partial<Stripe.PaymentIntent>));
    const service = new CustomerUnlockService(repository, fake.stripe);

    await expect(service.confirm("user_customer")).rejects.toMatchObject({
      code: "PAYMENT_STATE_INVALID",
    });
    expect(repository.current.customerUnlockedAt).toBeNull();
  });

  it("does not confirm a pending intent", async () => {
    const repository = new FakeRepository(user({
      customerStripeCustomerId: "cus_unlock",
      customerUnlockPaymentIntentId: "pi_unlock",
    }));
    const fake = stripeFake(intent({ status: "processing" }));
    const service = new CustomerUnlockService(repository, fake.stripe);

    await expect(service.confirm("user_customer")).rejects.toMatchObject({
      code: "PAYMENT_NOT_SUCCEEDED",
    });
  });
});