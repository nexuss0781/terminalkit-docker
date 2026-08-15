import assert from "node:assert/strict";
import test from "node:test";

process.env.TERMINAL_KIT_TEST = "1";
const { createOrderedStdinWriter } = await import("./agent.mjs");

test("delivers separately accepted interactive inputs in submission order", async () => {
  const writes = [];
  const stdin = {
    writable: true,
    write(input, callback) {
      const delay = input === "first\r" ? 15 : 0;
      setTimeout(() => { writes.push(input); callback(); }, delay);
      return true;
    },
  };
  const writeInput = createOrderedStdinWriter(stdin);
  await Promise.all([writeInput("first\r"), writeInput("second\r"), writeInput("third\r")]);
  assert.deepEqual(writes, ["first\r", "second\r", "third\r"]);
});
