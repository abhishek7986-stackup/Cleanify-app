import { expect, type Browser, type Page } from "@playwright/test";
import pg from "pg";

export const USERS = {
  admin: { username: "admin", password: process.env.SEED_ADMIN_PASSWORD ?? "CleanifyAdmin#2026", home: "/admin" },
  priya: { username: "priya", password: process.env.SEED_SALES_PASSWORD ?? "CleanifySales#2026", home: "/sales" },
  ravi: { username: "ravi", password: process.env.SEED_SUPERVISOR_PASSWORD ?? "CleanifySuper#2026", home: "/s" },
} as const;

export type Who = keyof typeof USERS;

export const TEST_NOTE = "automated test";

export async function login(page: Page, who: Who) {
  const u = USERS[who];
  await page.goto("/login");
  await page.getByLabel("Username or mobile number").fill(u.username);
  await page.getByLabel("Password", { exact: true }).fill(u.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith(u.home));
}

/** A signed-in page in its own browser context, so roles never share cookies. */
export async function pageAs(browser: Browser, who: Who, contextOptions = {}) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await login(page, who);
  return page;
}

/** Takes one photo with Chromium's fake camera and accepts it. */
export async function takePhoto(page: Page) {
  const shutter = page.locator('button[aria-label="Take photo"]');
  await expect(shutter).toBeEnabled({ timeout: 20_000 });
  await shutter.click();
  await page.getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByLabel("Live camera")).toHaveCount(0, { timeout: 30_000 });
}

export async function db<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

/** Today's date and a clock time `minutesAhead` from now, both in IST. */
export function istSlot(minutesAhead: number) {
  const ist = new Date(Date.now() + 5.5 * 3600_000 + minutesAhead * 60_000);
  const rounded = Math.ceil(ist.getUTCMinutes() / 15) * 15;
  ist.setUTCMinutes(rounded, 0, 0);
  return {
    date: ist.toISOString().slice(0, 10),
    time: ist.toISOString().slice(11, 16),
  };
}

export function istToday() {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** page.goto that survives a screen's own auto-refresh cancelling the navigation. */
export async function go(page: Page, path: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.goto(path, { timeout: 45_000 });
    } catch (e) {
      if (attempt >= 3 || !String(e).includes("ERR_ABORTED")) throw e;
    }
  }
}
