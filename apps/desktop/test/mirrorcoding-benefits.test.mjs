import assert from "node:assert/strict";
import test from "node:test";
import {
  MirrorCodingBenefitsService,
  parseBenefits,
} from "../electron/main/mirrorcoding/benefits.ts";
import { subscriptionQuota } from "../src/features/account/benefits-model.ts";

export const benefitsFixture = () => ({
  success: true,
  data: {
    permissions: { subscriptions_read: true, check_in: true },
    quota_per_unit: 500000,
    quota_unit: "credits",
    subscriptions: [
      {
        id: "1",
        name: "Pro",
        expires_at: "2099-12-31T00:00:00Z",
        quota_total: 5000000,
        quota_used: 1000000,
        next_reset_at: null,
        groups: ["default"],
      },
    ],
    check_in: {
      enabled: true,
      checked_in: false,
      date: "2026-10-18",
      time_zone: "Asia/Shanghai",
      reward: null,
    },
  },
});
function fixture(request) {
  const account = {
    authorizationId: "A",
    status: "connected",
    snapshot() {
      return { status: this.status };
    },
    request,
  };
  return { account, service: new MirrorCodingBenefitsService(account) };
}
test("load subscriptions, check in once, refresh reward and retain quota units", async () => {
  const body = benefitsFixture();
  const paths = [];
  const { service } = fixture(async (path, init) => {
    paths.push([path, init.method]);
    if (init.method === "POST") {
      body.data.check_in.checked_in = true;
      body.data.check_in.reward = 250000;
    }
    return Response.json(body);
  });
  assert.equal((await service.load()).data.subscriptions[0].quotaUsed, 1000000);
  const [first, second] = await Promise.all([service.load(true), service.load(true)]);
  assert.equal(first.data.checkIn.reward, 250000);
  assert.equal(second.data.checkIn.checkedIn, true);
  assert.equal(paths.filter(([, method]) => method === "POST").length, 1);
  assert.equal(
    first.data.subscriptions[0].quotaTotal,
    5000000,
    "wallet reward is not subscription quota",
  );
});
test("logout/account change discards late responses and cannot redirect a queued check-in", async () => {
  let resolve;
  let calls = 0;
  const { account, service } = fixture(() => {
    calls++;
    return new Promise((r) => {
      resolve = r;
    });
  });
  const load = service.load();
  const checkIn = service.load(true);
  account.authorizationId = "B";
  resolve(Response.json(benefitsFixture()));
  assert.equal((await load).data, undefined);
  assert.equal((await checkIn).error, "reauthorization_required");
  assert.equal(calls, 1);
  account.status = "signed_out";
  assert.equal((await service.load()).error, "reauthorization_required");
});
for (const [status, code] of [
  [404, "unavailable"],
  [403, "permission_required"],
  [401, "reauthorization_required"],
  [500, "request_failed"],
]) {
  test(`HTTP ${status} is explicit unavailable data, never fake zero quota`, async () => {
    const { service } = fixture(async () => new Response(null, { status }));
    assert.deepEqual(await service.load(), { status: "error", error: code });
  });
}
test("verification is not bypassed, and denied permission never performs check-in", async () => {
  let calls = 0;
  const body = benefitsFixture();
  body.data.permissions.check_in = false;
  const { service } = fixture(async () => {
    calls++;
    return Response.json(body);
  });
  await service.load();
  assert.equal((await service.load(true)).error, "permission_required");
  assert.equal(calls, 1);
  const denied = fixture(async () =>
    Response.json({ error: "verification_required" }, { status: 403 }),
  );
  assert.equal((await denied.service.load()).error, "verification_required");
});
test("remaining percentage is weighted, expiration-aware, and handles unlimited and zero", () => {
  const data = parseBenefits(benefitsFixture());
  assert.equal(subscriptionQuota(data).percent, 80);
  data.subscriptions.push({
    ...data.subscriptions[0],
    id: "2",
    quotaTotal: 15000000,
    quotaUsed: 15000000,
  });
  assert.equal(subscriptionQuota(data).percent, 20, "plans are weighted by quota, not averaged");
  data.subscriptions.pop();
  for (const [used, tone] of [
    [2500000, "yellow"],
    [4000000, "red"],
    [6000000, "red"],
  ]) {
    data.subscriptions[0].quotaUsed = used;
    assert.equal(subscriptionQuota(data).tone, tone);
  }
  data.subscriptions[0].quotaTotal = null;
  assert.equal(subscriptionQuota(data).percent, null);
  assert.equal(subscriptionQuota(data).unlimited, true);
  data.subscriptions[0].quotaTotal = 0;
  assert.equal(subscriptionQuota(data).percent, 0);
  data.subscriptions[0].expiresAt = "2000-01-01T00:00:00Z";
  assert.equal(subscriptionQuota(data).tone, "unknown");
});
test("invalid quota and date values are rejected at the service boundary", () => {
  for (const value of [-1, "123", NaN, Infinity]) {
    const body = benefitsFixture();
    body.data.subscriptions[0].quota_used = value;
    assert.throws(() => parseBenefits(body), /invalid_response/);
  }
  const body = benefitsFixture();
  body.data.subscriptions[0].expires_at = "not a date";
  assert.throws(() => parseBenefits(body), /invalid_response/);
});
test("dispose cancels in-flight work and cannot publish its result", async () => {
  let resolve;
  let signal;
  const { service } = fixture((_path, init) => {
    signal = init.signal;
    return new Promise((r) => {
      resolve = r;
    });
  });
  const load = service.load();
  service.dispose();
  assert.equal(signal.aborted, true);
  resolve(Response.json(benefitsFixture()));
  assert.equal((await load).data, undefined);
});

test("a failed refresh clears previously successful quota", async () => {
  let offline = false;
  const { service } = fixture(async () => {
    if (offline) throw new Error("network disconnected");
    return Response.json(benefitsFixture());
  });
  assert.equal((await service.load()).status, "ready");
  offline = true;
  assert.deepEqual(await service.load(), { status: "error", error: "request_failed" });
});

test("subscription permission denial cannot disclose plans", () => {
  const body = benefitsFixture();
  body.data.permissions.subscriptions_read = false;
  assert.throws(() => parseBenefits(body), /invalid_response/);
  body.data.subscriptions = [];
  assert.equal(subscriptionQuota(parseBenefits(body)).tone, "unknown");
});
