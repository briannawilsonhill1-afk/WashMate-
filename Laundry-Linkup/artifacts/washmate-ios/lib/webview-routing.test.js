import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedWebViewUrl,
  resolveWashMateUrl,
  routeForNotification,
  shouldOpenExternally,
} from "./webview-routing.js";

test("defaults the canonical URL to the verified production site", () => {
  assert.equal(resolveWashMateUrl(""), "https://washloop.net");
});

test("accepts first-party HTTPS routes and rejects lookalike or downgraded hosts", () => {
  assert.equal(
    isAllowedWebViewUrl("https://washloop.net/orders/42", "washloop.net"),
    true,
  );
  assert.equal(
    isAllowedWebViewUrl("https://washloop.net.evil.example/orders/42", "washloop.net"),
    false,
  );
  assert.equal(
    isAllowedWebViewUrl("http://washloop.net/orders/42", "washloop.net"),
    false,
  );
  assert.equal(
    isAllowedWebViewUrl("https://www.washloop.net/orders/42", "washloop.net"),
    false,
  );
  assert.equal(isAllowedWebViewUrl("mailto:help@washloop.net", "washloop.net"), false);
});

test("allows the WebView bootstrap page", () => {
  assert.equal(isAllowedWebViewUrl("about:blank", "washloop.net"), true);
  assert.equal(isAllowedWebViewUrl("about:srcdoc", "washloop.net"), false);
});

test("hands valid external links to the OS but silently blocks malformed URLs", () => {
  assert.equal(
    shouldOpenExternally("https://maps.apple.com/?q=laundry", "washloop.net"),
    true,
  );
  assert.equal(shouldOpenExternally("tel:+15551234567", "washloop.net"), true);
  assert.equal(
    shouldOpenExternally("https://washloop.net/customer", "washloop.net"),
    false,
  );
  assert.equal(shouldOpenExternally("not a URL", "washloop.net"), false);
});

test("rejects malformed or unsafe canonical build URLs", () => {
  assert.throws(() => resolveWashMateUrl("not a URL"));
  assert.throws(() => resolveWashMateUrl("http://washloop.net"));
  assert.throws(() => resolveWashMateUrl("https://washloop.net/customer"));
});

test("routes notification deep links to the correct first-party page", () => {
  assert.equal(routeForNotification({ type: "new_order", orderId: 42 }), "/washer");
  assert.equal(routeForNotification({ type: "order_status", orderId: 42 }), "/orders/42");
  assert.equal(routeForNotification({ type: "order_status" }), "/customer");
});