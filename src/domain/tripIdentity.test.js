import assert from "node:assert/strict";
import test from "node:test";
import { buildTripOptions, getRecordTripId } from "./tripIdentity.js";

test("historical numeric travel labels share an identity without date-based guesses", () => {
  for (const name of ["3", "3ª viagem", "3a viagem", "Viagem 3", "Viagem nº 3"]) {
    assert.equal(getRecordTripId({ tripName: name }), "legacy-number-3");
  }
  assert.notEqual(getRecordTripId({ tripName: "3ª viagem 2026" }),
    getRecordTripId({ tripName: "3ª viagem 2027" }));
  assert.equal(getRecordTripId({ saleDate: "2026-10-01" }), "");
  assert.equal(getRecordTripId({ tripId: "trip-unique", tripName: "3" }), "trip-unique");
});

test("trip options deduplicate historical aliases but preserve separate new trips with equal names", () => {
  const options = buildTripOptions({
    trips: [{ id: "trip-one", name: "3" }, { id: "trip-two", name: "3" }],
    sales: [{ tripName: "3" }, { tripName: "3ª viagem" }],
    visits: [{ tripName: "Rota Sul" }],
  });
  assert.equal(options.length, 4);
  assert.equal(options.filter((trip) => trip.id === "legacy-number-3").length, 1);
});
