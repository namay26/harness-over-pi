// Every test imports from here: a console error or a 5xx response fails the test.
import { expect, test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console error: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
    page.on("response", (response) => {
      if (response.status() >= 500) problems.push(`${response.status()} from ${response.url()}`);
    });
    await use(page);
    expect(problems).toEqual([]);
  },
});

export { expect };
