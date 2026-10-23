import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTripOptions,
  getRecordTripId,
  getTripOptionLabel,
  getTripNumberYear,
  tripMatchesRecord,
} from "./tripIdentity.js";

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

test("trip number and year remain distinct across years", () => {
  const firstTrip = { tripId: "trip-2027-1", name: "1ª viagem/2027" };
  const secondTrip = { tripId: "trip-2028-1", name: "1ª viagem/2028" };
  assert.equal(getRecordTripId(firstTrip), "trip-2027-1");
  assert.deepEqual(getTripNumberYear(firstTrip), { tripNumber: 1, tripYear: 2027 });
  assert.equal(getTripOptionLabel(firstTrip), "1ª viagem/2027");
  assert.equal(
    getRecordTripId({ tripName: "1ª viagem/2027" }),
    "legacy-number-1-2027"
  );
  assert.equal(
    tripMatchesRecord(
      { tripName: "1ª viagem/2027", totalAmount: 100 },
      { id: "legacy-number-1-2027", ...getTripNumberYear(firstTrip) }
    ),
    true
  );
  assert.equal(
    tripMatchesRecord(
      { tripName: "1ª viagem/2028", totalAmount: 100 },
      { id: "legacy-number-1-2027", ...getTripNumberYear(firstTrip) }
    ),
    false
  );
  assert.equal(
    tripMatchesRecord(
      { tripNumber: 3 },
      { id: "legacy-number-3-2027", tripNumber: 3, tripYear: 2027 }
    ),
    false
  );
  assert.equal(
    tripMatchesRecord(
      { tripId: "legacy-number-3", tripNumber: 3 },
      { id: "trip-3-2026", tripNumber: 3, tripYear: 2026 }
    ),
    true
  );
  assert.equal(
    tripMatchesRecord(
      { tripId: "different-id", tripName: "1ª viagem/2027" },
      firstTrip
    ),
    false
  );
  assert.notEqual(getRecordTripId(firstTrip), getRecordTripId(secondTrip));
});
