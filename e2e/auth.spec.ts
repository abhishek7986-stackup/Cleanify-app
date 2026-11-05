import { expect, test } from "@playwright/test";
import { login, USERS, type Who } from "./helpers";

test.describe("sign-in", () => {
  test("a wrong password is refused with a clear message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username or mobile number").fill("priya");
    await page.getByLabel("Password", { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("That username or password was not recognised.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  for (const who of Object.keys(USERS) as Who[]) {
    test(`${who} signs in and lands on ${USERS[who].home}`, async ({ page }) => {
      await login(page, who);
      await expect(page).toHaveURL(new RegExp(`${USERS[who].home}$`));
    });
  }

  test("signing out ends the session", async ({ page }) => {
    await login(page, "priya");
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/login/);
    await page.goto("/sales");
    await expect(page).toHaveURL(/\/login\?next=%2Fsales/);
  });
});

test.describe("page access by role", () => {
  test("signed-out visitors are sent to sign-in, keeping where they were going", async ({ page }) => {
    for (const path of ["/admin", "/sales/new", "/s/checkin"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}`));
    }
  });

  test("?next= cannot send someone to another site", async ({ page }) => {
    await page.goto("/login?next=//evil.example.com");
    await page.getByLabel("Username or mobile number").fill("priya");
    await page.getByLabel("Password", { exact: true }).fill(USERS.priya.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/localhost:3100\/sales/);
  });

  const blocked: [Who, string[]][] = [
    ["ravi", ["/admin", "/admin/users", "/sales", "/sales/new", "/sales/approvals"]],
    ["priya", ["/admin", "/admin/users", "/s", "/s/checkin"]],
  ];
  for (const [who, paths] of blocked) {
    test(`${who} is kept out of other roles' screens`, async ({ page }) => {
      await login(page, who);
      for (const path of paths) {
        await page.goto(path);
        await expect(page, `${who} opening ${path}`).toHaveURL(new RegExp(`${USERS[who].home}$`));
      }
    });
  }

  test("admin can open every surface", async ({ page }) => {
    await login(page, "admin");
    for (const path of ["/admin", "/admin/users", "/admin/services", "/sales", "/sales/approvals"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
  });
});

test.describe("public API routes", () => {
  test("/api/time returns the server clock", async ({ request }) => {
    const res = await request.get("/api/time");
    expect(res.ok()).toBeTruthy();
    expect(JSON.stringify(await res.json())).toMatch(/20\d\d-/);
  });

  test("/api/dispatch refuses a caller without the secret", async ({ request }) => {
    const res = await request.post("/api/dispatch");
    expect([401, 403]).toContain(res.status());
  });

  test("/api/resolve-location needs a signed-in user", async ({ request }) => {
    const res = await request.get("/api/resolve-location?url=https://maps.app.goo.gl/abc", { maxRedirects: 0 });
    expect(res.status()).not.toBe(200);
  });
});
