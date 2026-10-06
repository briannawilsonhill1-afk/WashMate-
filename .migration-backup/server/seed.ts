import { storage } from "./storage";

async function seed() {
  const orders = await storage.getOrders();
  if (orders.length === 0) {
    const customer = await storage.createUser({ username: 'alice_customer', role: 'customer', address: '123 Main St, Springfield' });
    const washer = await storage.createUser({ username: 'bob_washer', role: 'washer', address: '456 Elm St, Springfield' });

    await storage.createOrder({
      customerId: customer.id,
      loadSize: 'small',
      flatFee: 25,
      pickupFee: 0,
      soiledFee: 0,
      extraFolding: true,
      hasPetHair: false,
      heavilySoiled: false,
      soilNotes: null,
      soapPreference: 'washer_provided',
      recurringInterval: 'none',
      totalFee: 35,
      pickupAddress: customer.address ?? '123 Main St, Springfield',
    });

    const order2 = await storage.createOrder({
      customerId: customer.id,
      loadSize: 'medium',
      flatFee: 35,
      pickupFee: 0,
      soiledFee: 0,
      extraFolding: false,
      hasPetHair: false,
      heavilySoiled: false,
      soilNotes: null,
      soapPreference: 'washer_provided',
      recurringInterval: 'none',
      totalFee: 35,
      pickupAddress: customer.address ?? '123 Main St, Springfield',
    });
    await storage.claimOrder(order2.id, washer.id);

    const order3 = await storage.createOrder({
      customerId: customer.id,
      loadSize: 'small',
      flatFee: 25,
      pickupFee: 0,
      soiledFee: 0,
      extraFolding: true,
      hasPetHair: false,
      heavilySoiled: false,
      soilNotes: null,
      soapPreference: 'washer_provided',
      recurringInterval: 'none',
      totalFee: 35,
      pickupAddress: customer.address ?? '123 Main St, Springfield',
    });
    await storage.claimOrder(order3.id, washer.id);
    await storage.updateOrderStatus(order3.id, 'completed');

    console.log("Database seeded successfully");
  } else {
    console.log("Database already has data, skipping seed");
  }
}

seed().catch(console.error).then(() => process.exit(0));
