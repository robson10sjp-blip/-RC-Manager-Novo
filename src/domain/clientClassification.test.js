import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_CLASSIFICATIONS,
  normalizeClientClassification,
  resolveClientClassification,
} from "./clientClassification.js";

test("exposes all manual customer ratings, including unclassified", () => {
  assert.deepEqual(
    CLIENT_CLASSIFICATIONS.map(({ id }) => id),
    ["unclassified", "excellent", "good", "regular", "poor", "prego"]
  );
});

test("keeps legacy Prego records until a customer is explicitly reclassified", () => {
  const legacyPregoIds = new Set(["client-1"]);

  assert.equal(
    resolveClientClassification({ id: "client-1" }, legacyPregoIds),
    "prego"
  );
  assert.equal(
    resolveClientClassification(
      { id: "client-1", classification: "good" },
      legacyPregoIds
    ),
    "good"
  );
  assert.equal(
    resolveClientClassification(
      { id: "client-1", classification: "unclassified" },
      legacyPregoIds
    ),
    "unclassified"
  );
});

test("unknown and missing ratings resolve to unclassified", () => {
  assert.equal(normalizeClientClassification("unexpected"), "unclassified");
  assert.equal(resolveClientClassification({ id: "client-2" }), "unclassified");
});
