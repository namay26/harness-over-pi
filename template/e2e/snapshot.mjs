// Prints the accessible content of one page of the app.
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const response = await page.goto(new URL(process.argv[2] ?? "/", process.env.BASE_URL).href);
  await page.waitForLoadState("networkidle");
  console.log(`HTTP ${response?.status()}`);
  console.log(await page.locator("body").ariaSnapshot());
} finally {
  await browser.close();
}
