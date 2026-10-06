---
name: DOM test runtime
description: Node compatibility constraint for browser-like unit tests
---
Use a DOM test environment compatible with the workspace's Node runtime.

**Why:** jsdom 30 failed before collecting tests here because the runtime lacks the global `Iterator` API. jsdom 26 works without changing the application's runtime.

**How to apply:** When upgrading jsdom, check the actual Node version and required JavaScript APIs first; do not interpret a worker-start failure as an application regression.