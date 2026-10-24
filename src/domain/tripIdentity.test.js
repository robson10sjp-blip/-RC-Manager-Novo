import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTripOptions,
  getRecordTripId,
  getTripOptionLabel,
  getTripNumberYear,
  tripMatchesRecord,
  buildNewTrip,
  getSaleTripEditFields,
  filterRecordsByTrip,
  buildTripReview,
} from "./tripIdentity.js";

test("historical numeric travel labels share an identity without date-based guesses", () => {
  for (const name of ["3", "3ª viagem", "3a viagem", "Viagem 3", "Viagem nº 3"]) {
    assert.equal(getRecordTripId({ tripName: name }), "legacy-number-3");
  }
  assert.notEqual(getRecordTripId({ tripName: "3ª viagem 2026" }),
    getRecordTripId({ tripName: "3ª viagem 2027" }));
  assert.equal(getRecordTripId({ saleDate: "2026-10-01" }), "trip-2026-4");
  assert.equal(getRecordTripId({ tripId: "trip-unique", tripName: "3" }), "trip-unique");
});

test("trip options deduplicate historical aliases but preserve separate new trips with equal names", () => {
  const options = buildTripOptions({
    trips: [{ id: "trip-one", name: "3" }, { id: "trip-two", name: "3" }],
    payables: [{ tripName: "3" }, { tripName: "3ª viagem" }],
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
  assert.equal(getTripOptionLabel(firstTrip), "1ª viagem de 2027");
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
    false
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

test("annual creation uses required number/year and stable identity", () => {
  assert.deepEqual(buildNewTrip({ tripNumber: 4, tripYear: 2026 }), {
    id: "trip-2026-4", name: "4ª viagem de 2026", tripNumber: 4, tripYear: 2026,
  });
  assert.notEqual(buildNewTrip({ tripNumber: 4, tripYear: 2026 }).id,
    buildNewTrip({ tripNumber: 4, tripYear: 2027 }).id);
  for (const input of [
    { tripNumber: 5, tripYear: 2026 }, { tripNumber: 1, tripYear: "" },
    { tripNumber: 2, tripYear: 2026.5 },
  ]) assert.throws(() => buildNewTrip(input));
});

test("unchanged sale editing never writes trip fields, including legacy/missing references", () => {
  for (const form of [
    { tripId: "old-id", tripName: "4 viagem" },
    { tripId: "legacy-number-4", tripName: "" },
    { tripId: "", tripName: "" },
  ]) assert.deepEqual(getSaleTripEditFields(form, false), {});
  assert.deepEqual(getSaleTripEditFields({ tripId: "", tripName: "" }, true), {
    tripId: "", tripName: "", tripNumber: null, tripYear: null,
  });
});

test("ID-less, missing-year and equal-name references stay distinct, without losing general totals", () => {
  const trips = [
    { id: "a", name: "4 viagem" }, { id: "b", name: "4 viagem" },
    { id: "trip-2026-4", tripNumber: 4, tripYear: 2026, name: "4ª viagem de 2026" },
    { id: "trip-2027-4", tripNumber: 4, tripYear: 2027, name: "4ª viagem de 2027" },
  ];
  const sales = [
    { id: "s1", tripId: "a", tripName: "4 viagem", totalAmount: 100, tripCity: "Tucumã" },
    { id: "s2", tripId: "b", tripName: "4 viagem", totalAmount: 200, tripCity: "Xinguara" },
    { id: "s3", tripId: "trip-2026-4", totalAmount: 300 },
    { id: "s4", tripId: "trip-2027-4", totalAmount: 400 },
    { id: "s5", tripName: "4 viagem", totalAmount: 500 },
    { id: "s6", totalAmount: 600 },
  ];
  const options = buildTripOptions({ trips, payables: sales });
  assert.equal(filterRecordsByTrip(sales, "all", options).reduce((sum, sale) => sum + sale.totalAmount, 0), 2100);
  assert.deepEqual(filterRecordsByTrip(sales, "trip-2026-4", options).map((sale) => sale.id), ["s3"]);
  assert.deepEqual(filterRecordsByTrip(sales, "unassigned", options).map((sale) => sale.id), ["s6"]);
  assert.deepEqual(filterRecordsByTrip(sales, "a", options)
    .filter((sale) => sale.tripCity === "Tucumã").map((sale) => sale.id), ["s1"]);
  const review = buildTripReview({ trips, sales });
  assert.ok(review.some((row) => row.recordId === "s1"));
  assert.ok(review.some((row) => row.recordId === "s5"));
  assert.equal(getTripNumberYear({ tripName: "4 viagem", createdAt: "2026-01-01" }).tripYear, null);
});

test("review includes incomplete trip documents and conflicting stored metadata without modifying either", () => {
  const input = {
    trips: [
      { id: "old-trip", name: "4 viagem" },
      { id: "annual-trip", name: "4ª viagem de 2026", tripNumber: 4, tripYear: 2026 },
    ],
    sales: [{ id: "conflict", tripId: "annual-trip", tripNumber: 4, tripYear: 2027 }],
  };
  const before = JSON.stringify(input);
  const review = buildTripReview(input);
  assert.ok(review.some((row) => row.collection === "trips" && row.recordId === "old-trip"));
  assert.ok(review.some((row) => row.recordId === "conflict" && row.reason.includes("diverge")));
  assert.equal(JSON.stringify(input), before);
});

test("labels resolve an exact registered ID without rebinding equal-name records or guessing years", () => {
  const options = buildTripOptions({ trips: [{ id: "original", name: "4 viagem", tripNumber: 4, tripYear: 2026 }] });
  assert.equal(getTripOptionLabel({ tripId: "original", tripName: "4 viagem" }, options), "4ª viagem de 2026");
  assert.equal(getTripOptionLabel({ tripId: "other", tripName: "4 viagem" }, options), "4ª viagem (ano não informado)");
  assert.equal(getTripOptionLabel({ tripName: "4 viagem" }, options), "4ª viagem (ano não informado)");
});

test("conflicting references to one missing ID never pick the last observed year", () => {
  const sales = [
    { id: "a", tripId: "missing", tripName: "4ª viagem de 2026" },
    { id: "b", tripId: "missing", tripName: "4ª viagem de 2027" },
  ];
  for (const ordered of [sales, [...sales].reverse()]) {
    const options = buildTripOptions({ payables: ordered });
    assert.equal(options.length, 1);
    assert.equal(options[0].tripYear, null);
    assert.equal(getTripOptionLabel(options[0]), "4ª viagem (ano em conflito)");
    assert.equal(buildTripReview({ sales: ordered }).length, 2);
    assert.equal(filterRecordsByTrip(sales, "missing", options).length, 2);
  }
});

test("registered identity is authoritative but divergent linked records are marked for review", () => {
  const trips = [{ id: "registered", name: "4ª viagem de 2026", tripNumber: 4, tripYear: 2026 }];
  const sales = [{ id: "conflict", tripId: "registered", tripYear: 2027, tripNumber: 4 }];
  const [option] = buildTripOptions({ trips, payables: sales });
  assert.equal(option.identityConflict, true);
  assert.equal(option.reviewRequired, true);
  assert.equal(getTripOptionLabel(option), "4ª viagem de 2026");
  assert.equal(getTripOptionLabel(sales[0], [option]), "4ª viagem de 2026");
  assert.equal(buildTripReview({ trips, payables: sales }).length, 2);
});
