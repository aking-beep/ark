import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { errorMessage } from "./api.ts";

describe("errorMessage", () => {
  test("an unreachable scoring service reads as a sentence, not JSON", () => {
    const m = errorMessage(502, '{"error":"AI Fit API is unreachable"}');
    assert.match(m, /can't reach its scoring service/);
    assert.doesNotMatch(m, /[{}]/);
  });
  test("API detail text is shown without its JSON wrapper", () => {
    assert.equal(errorMessage(404, '{"detail":"Session not found"}'), "Session not found");
  });
  test("rate limits and non-JSON bodies get plain lines", () => {
    assert.match(errorMessage(429, ""), /Wait a minute/);
    assert.match(errorMessage(500, "<html>"), /Something went wrong \(500\)/);
  });
});
