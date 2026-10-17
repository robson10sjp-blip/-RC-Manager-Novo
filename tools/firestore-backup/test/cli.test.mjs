import assert from "node:assert/strict";
import test from "node:test";
import {
  parseArguments,
  createImpersonatedAdcConfig,
  summarizeCollectionCounts,
  validateLiveOptions,
} from "../src/cli.mjs";

test("blocks any live read unless explicitly enabled", () => {
  const options = parseArguments([
    "--project-id",
    "fixture-only",
    "--output",
    "/tmp/fixture.json.enc",
  ]);

  assert.throws(() => validateLiveOptions(options), /Leitura real bloqueada/);
});

test("requires an absolute encrypted output path and explicit live-read opt-in", () => {
  const options = parseArguments([
    "--project-id",
    "fixture-only",
    "--output",
    "fixture.json",
    "--live-read-confirmed",
    "--writes-paused-confirmed",
  ]);

  assert.throws(() => validateLiveOptions(options), /absoluto/);
});

test("requires confirmation that all writers are paused", () => {
  const options = parseArguments([
    "--project-id",
    "fixture-only",
    "--output",
    "/tmp/fixture.json.enc",
    "--live-read-confirmed",
  ]);

  assert.throws(() => validateLiveOptions(options), /Confirme gravações pausadas/);
});

test("allows a separately acknowledged best-effort read with concurrent writers", () => {
  const options = parseArguments([
    "--project-id",
    "fixture-only",
    "--output",
    "/tmp/fixture.json.enc",
    "--live-read-confirmed",
    "--accept-concurrent-writes-risk",
  ]);

  assert.doesNotThrow(() => validateLiveOptions(options));
});

test("does not allow claiming paused writes and accepting concurrent-write risk together", () => {
  const options = parseArguments([
    "--project-id",
    "fixture-only",
    "--output",
    "/tmp/fixture.json.enc",
    "--live-read-confirmed",
    "--writes-paused-confirmed",
    "--accept-concurrent-writes-risk",
  ]);

  assert.throws(() => validateLiveOptions(options), /Escolha somente um modo/);
});

test("rejects unknown options", () => {
  assert.throws(() => parseArguments(["--credential-json", "secret.json"]), /Opção desconhecida/);
});

test("redacts document IDs from collection counts printed to the terminal", () => {
  assert.deepEqual(
    summarizeCollectionCounts({
      "users/u1/sales": 2,
      "users/u2/sales": 5,
      "users/u1/sales/s1/payments": 1,
    }),
    {
      "users/{doc}/sales": 7,
      "users/{doc}/sales/{doc}/payments": 1,
    }
  );
});

test("builds ADC impersonation config without requiring a private key", () => {
  const sourceCredentials = {
    type: "authorized_user",
    client_id: "fixture-client-id",
    client_secret: "fixture-client-secret",
    refresh_token: "fixture-refresh-token",
  };
  const config = createImpersonatedAdcConfig("fixture-project", sourceCredentials);

  assert.equal(config.type, "impersonated_service_account");
  assert.equal(config.source_credentials, sourceCredentials);
  assert.equal(
    config.service_account_impersonation_url,
    "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/rc-manager-firestore-backup@fixture-project.iam.gserviceaccount.com:generateAccessToken"
  );
  assert.deepEqual(config.scopes, ["https://www.googleapis.com/auth/cloud-platform"]);
  assert.equal("private_key" in config, false);
});

test("rejects ADC source credentials that contain private keys", () => {
  assert.throws(
    () =>
      createImpersonatedAdcConfig("fixture-project", {
        type: "authorized_user",
        private_key: "fixture-only-not-a-real-key",
      }),
    /não conter chave privada/
  );
});