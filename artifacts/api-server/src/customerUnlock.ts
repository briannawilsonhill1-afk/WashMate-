import type Stripe from "stripe";
import type { User } from "@workspace/db";

export const CUSTOMER_UNLOCK_AMOUNT_CENTS = 299;
export const CUSTOMER_UNLOCK_CURRENCY = "usd";
export const CUSTOMER_UNLOCK_PURPOSE = "washmate_customer_unlock";

export type UnlockUser = Pick<
  User,
  | "id"
  | "role"
  | "email"
  | "customerStripeCustomerId"
  | "customerUnlockPaymentIntentId"
  | "customerUnlockedAt"
>;

export interface CustomerUnlockRepository {
  get(userId: string): Promise<UnlockUser | undefined>;
  withLock<T>(
    userId: string,
    callback: (user: UnlockUser, update: (values: Partial<Pick<
      UnlockUser,
      "customerStripeCustomerId" | "customerUnlockPaymentIntentId" | "customerUnlockedAt"
    >>) => Promise<UnlockUser>) => Promise<T>,
  ): Promise<T>;
  markUnlocked(userId: string, paymentIntentId: string): Promise<boolean>;
}

export interface CustomerUnlockStripe {
  customers: {
    create(
      params: Stripe.CustomerCreateParams,
      options?: Stripe.RequestOptions,
    ): Promise<Stripe.Customer>;
  };
  paymentIntents: {
    create(
      params: Stripe.PaymentIntentCreateParams,
      options?: Stripe.RequestOptions,
    ): Promise<Stripe.PaymentIntent>;
    retrieve(id: string): Promise<Stripe.PaymentIntent>;
  };
}

export class CustomerUnlockError extends Error {
  constructor(
    public readonly code:
      | "CUSTOMER_ONLY"
      | "PAYMENT_STATE_INVALID"
      | "PAYMENT_NOT_SUCCEEDED",
    message: string,
  ) {
    super(message);
  }
}

function stripeResourceId(
  resource: string | { id: string } | null,
): string | null {
  return typeof resource === "string" ? resource : resource?.id ?? null;
}

export function isOwnedUnlockPayment(
  intent: Stripe.PaymentIntent,
  user: UnlockUser,
): boolean {
  return (
    intent.id === user.customerUnlockPaymentIntentId &&
    intent.amount === CUSTOMER_UNLOCK_AMOUNT_CENTS &&
    intent.currency.toLowerCase() === CUSTOMER_UNLOCK_CURRENCY &&
    intent.metadata["washmateUserId"] === user.id &&
    intent.metadata["purpose"] === CUSTOMER_UNLOCK_PURPOSE &&
    !!user.customerStripeCustomerId &&
    stripeResourceId(intent.customer) === user.customerStripeCustomerId
  );
}

export class CustomerUnlockService {
  constructor(
    private readonly repository: CustomerUnlockRepository,
    private readonly stripeProvider:
      | CustomerUnlockStripe
      | (() => Promise<CustomerUnlockStripe>),
  ) {}

  private async getStripe(): Promise<CustomerUnlockStripe> {
    return typeof this.stripeProvider === "function"
      ? this.stripeProvider()
      : this.stripeProvider;
  }

  private assertCustomer(user: UnlockUser | undefined): asserts user is UnlockUser {
    if (!user || user.role !== "customer") {
      throw new CustomerUnlockError(
        "CUSTOMER_ONLY",
        "Only customers can manage the customer unlock",
      );
    }
  }

  private async reconcile(user: UnlockUser): Promise<boolean> {
    if (user.customerUnlockedAt) return true;
    if (!user.customerUnlockPaymentIntentId) return false;

    const stripe = await this.getStripe();
    const intent = await stripe.paymentIntents.retrieve(
      user.customerUnlockPaymentIntentId,
    );
    if (!isOwnedUnlockPayment(intent, user)) {
      throw new CustomerUnlockError(
        "PAYMENT_STATE_INVALID",
        "Stored unlock payment failed server verification",
      );
    }
    if (intent.status !== "succeeded") return false;

    return this.repository.markUnlocked(user.id, intent.id);
  }

  async status(userId: string): Promise<boolean> {
    const user = await this.repository.get(userId);
    this.assertCustomer(user);
    return this.reconcile(user);
  }

  async payment(
    userId: string,
  ): Promise<{ unlocked: true } | { clientSecret: string }> {
    return this.repository.withLock(userId, async (initial, update) => {
      this.assertCustomer(initial);
      let user = initial;
      if (user.customerUnlockedAt) return { unlocked: true };
      const stripe = await this.getStripe();

      if (!user.customerStripeCustomerId) {
        const customer = await stripe.customers.create(
          {
            email: user.email,
            metadata: {
              washmateUserId: user.id,
              purpose: CUSTOMER_UNLOCK_PURPOSE,
            },
          },
          { idempotencyKey: `customer-unlock-customer-v1:${user.id}` },
        );
        user = await update({ customerStripeCustomerId: customer.id });
      }

      let intent: Stripe.PaymentIntent;
      if (user.customerUnlockPaymentIntentId) {
        intent = await stripe.paymentIntents.retrieve(
          user.customerUnlockPaymentIntentId,
        );
        if (!isOwnedUnlockPayment(intent, user)) {
          throw new CustomerUnlockError(
            "PAYMENT_STATE_INVALID",
            "Stored unlock payment failed server verification",
          );
        }
        // A canceled intent can never be confirmed again. It is also incapable
        // of later succeeding, so replacing it under the same user-row lock is
        // safe from double charge. The old intent id makes retries idempotent.
        if (intent.status === "canceled") {
          const canceledIntentId = intent.id;
          intent = await stripe.paymentIntents.create(
            {
              amount: CUSTOMER_UNLOCK_AMOUNT_CENTS,
              currency: CUSTOMER_UNLOCK_CURRENCY,
              customer: user.customerStripeCustomerId!,
              automatic_payment_methods: { enabled: true },
              metadata: {
                washmateUserId: user.id,
                purpose: CUSTOMER_UNLOCK_PURPOSE,
              },
              description: "WashMate one-time customer unlock",
            },
            {
              idempotencyKey:
                `customer-unlock-payment-v1:${user.id}:after:${canceledIntentId}`,
            },
          );
          user = await update({ customerUnlockPaymentIntentId: intent.id });
        }
      } else {
        intent = await stripe.paymentIntents.create(
          {
            amount: CUSTOMER_UNLOCK_AMOUNT_CENTS,
            currency: CUSTOMER_UNLOCK_CURRENCY,
            customer: user.customerStripeCustomerId!,
            automatic_payment_methods: { enabled: true },
            metadata: {
              washmateUserId: user.id,
              purpose: CUSTOMER_UNLOCK_PURPOSE,
            },
            description: "WashMate one-time customer unlock",
          },
          { idempotencyKey: `customer-unlock-payment-v1:${user.id}` },
        );
        user = await update({ customerUnlockPaymentIntentId: intent.id });
      }

      if (!isOwnedUnlockPayment(intent, user)) {
        throw new CustomerUnlockError(
          "PAYMENT_STATE_INVALID",
          "Stored unlock payment failed server verification",
        );
      }
      if (intent.status === "succeeded") {
        await update({ customerUnlockedAt: new Date() });
        return { unlocked: true };
      }
      if (!intent.client_secret) {
        throw new CustomerUnlockError(
          "PAYMENT_STATE_INVALID",
          "Unlock payment does not have a client secret",
        );
      }
      return { clientSecret: intent.client_secret };
    });
  }

  async confirm(userId: string): Promise<{ unlocked: true }> {
    const user = await this.repository.get(userId);
    this.assertCustomer(user);
    if (user.customerUnlockedAt) return { unlocked: true };
    if (!user.customerUnlockPaymentIntentId) {
      throw new CustomerUnlockError(
        "PAYMENT_NOT_SUCCEEDED",
        "Unlock payment has not succeeded",
      );
    }

    const unlocked = await this.reconcile(user);
    if (!unlocked) {
      throw new CustomerUnlockError(
        "PAYMENT_NOT_SUCCEEDED",
        "Unlock payment has not succeeded",
      );
    }
    return { unlocked: true };
  }
}