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

// Reloading while a save or delete is still in flight cancels it, so navigation waits for quiet.
function settleBeforeNavigating(page: Page) {
  let pending = 0;
  page.on("request", () => pending++);
  page.on("requestfinished", () => pending--);
  page.on("requestfailed", () => pending--);
  const settle = async () => {
    for (let quiet = 0, waited = 0; quiet < 3 && waited < 100; waited++) {
      await page.waitForTimeout(100);
      quiet = pending === 0 ? quiet + 1 : 0;
    }
  };
  const reload = page.reload.bind(page);
  const goto = page.goto.bind(page);
  page.reload = async (options) => (await settle(), reload(options));
  page.goto = async (url, options) => (await settle(), goto(url, options));
}

function prepare(page: Page, problems: string[]) {
  watch(page, problems);
  settleBeforeNavigating(page);
}

export const test = base.extend<{ otherPage: Page }>({
  page: async ({ page }, use) => {
    const problems: string[] = [];
    prepare(page, problems);
    await use(page);
    expect(problems).toEqual([]);
  },
  // A second visitor with separate cookies, for checking that users cannot see each other's data.
  otherPage: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const problems: string[] = [];
    prepare(page, problems);
    await use(page);
    await context.close();
    expect(problems).toEqual([]);
  },
});

export { expect };
