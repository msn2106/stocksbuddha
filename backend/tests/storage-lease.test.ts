import { test } from "node:test";
import assert from "node:assert/strict";
import { storageLease } from "../src/documents/lease";
import { onboardingFixture } from "./onboarding-fixture";

test("storage leases release connections, reject concurrent uploads, fence expired holders and recover failures", async () => {
  const f = onboardingFixture();
  try {
    let transfers = 0;
    const result = await storageLease(
      f.db,
      f.tenantId,
      async () => "prepared",
      async (prepared) => {
        assert.equal(prepared, "prepared");
        assert.equal(f.memory.isTransaction, false);
        transfers++;
        await assert.rejects(
          storageLease(
            f.db,
            f.tenantId,
            async () => null,
            async () => null,
            async () => "bad",
          ),
          /document_storage_busy/,
        );
        // Another tenant may progress during a slow provider request.
        assert.equal(
          await storageLease(
            f.db,
            f.otherTenantId,
            async () => null,
            async () => null,
            async () => "other",
          ),
          "other",
        );
        return "uploaded";
      },
      async (_manager, prepared, uploaded) => {
        assert.equal(f.memory.isTransaction, true);
        assert.equal(prepared, "prepared");
        assert.equal(uploaded, "uploaded");
        return "stored";
      },
    );
    assert.equal(result, "stored");
    assert.equal(transfers, 1);
    assert.equal(
      (await f.query("SELECT * FROM document_storage_leases")).length,
      0,
    );
    for (const takeover of [false, true]) {
      await assert.rejects(
        storageLease(
          f.db,
          f.tenantId,
          async () => null,
          async () => {
            await f.query(
              takeover
                ? "UPDATE document_storage_leases SET token='new-holder'"
                : "UPDATE document_storage_leases SET lease_until='2000-01-01'",
            );
            return null;
          },
          async () => {
            assert.fail("expired upload must not publish");
          },
        ),
        /document_storage_busy/,
      );
      if (takeover)
        assert.equal(
          (await f.query("SELECT token FROM document_storage_leases"))[0].token,
          "new-holder",
        );
      await f.query("DELETE FROM document_storage_leases");
    }
    await assert.rejects(
      storageLease(
        f.db,
        f.tenantId,
        async () => null,
        async () => {
          throw new Error("provider down");
        },
        async () => "bad",
      ),
      /provider down/,
    );
    assert.equal(
      (await f.query("SELECT * FROM document_storage_leases")).length,
      0,
    );
    await assert.rejects(
      storageLease(
        f.db,
        f.tenantId,
        async () => {
          throw new Error("denied");
        },
        async () => null,
        async () => "bad",
      ),
      /denied/,
    );
    assert.equal(
      (await f.query("SELECT * FROM document_storage_leases")).length,
      0,
    );
  } finally {
    f.close();
  }
});
