import { createProgram } from "../src/cli.js";

describe("CLI foundation", () => {
  it("uses the edstem command name", () => {
    expect(createProgram().name()).toBe("edstem");
  });
});
