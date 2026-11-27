// Every test imports from here: a console error or a 5xx response on any page fails the test.
import { expect, type Page, test as base } from "@playwright/test";

function watch(page: Page, problems: string[]) {
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) problems.push(`${response.status()} from ${response.url()}`);
  });
}

export const test = base.extend<{ otherPage: Page }>({
  page: async ({ page }, use) => {
    const problems: string[] = [];
    watch(page, problems);
    await use(page);
    expect(problems).toEqual([]);
  },
  // A second visitor with separate cookies, for checking that users cannot see each other's data.
  otherPage: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const problems: string[] = [];
    watch(page, problems);
    await use(page);
    await context.close();
    expect(problems).toEqual([]);
  },
});

export { expect };
