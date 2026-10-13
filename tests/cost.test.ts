import assert from "node:assert/strict";
import test from "node:test";
import { averageCostAfterReceipt, roundMoney } from "@/lib/cost";

test("средневзвешенная после прихода округляется до одного знака", () => {
  assert.equal(averageCostAfterReceipt(100, 100, 50, 120), 106.7);
  assert.equal(averageCostAfterReceipt(0, null, 10, 99.99), 100);
  assert.equal(averageCostAfterReceipt(10, 10, 10, 10), 10);
});

test("roundMoney держит один знак после запятой", () => {
  assert.equal(roundMoney(106.67), 106.7);
  assert.equal(roundMoney(106.64), 106.6);
  assert.equal(roundMoney(99.99), 100);
});
