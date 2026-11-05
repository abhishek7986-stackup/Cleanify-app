import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { pageAs } from "./helpers";

/**
 * Staff self sign-up → admin rejects with a reason → applicant sees it.
 * The account is deleted afterwards so test applicants don't pile up.
 */
const PHONE = `90000${String(Date.now()).slice(-5)}`;
const NAME = `E2E Applicant ${PHONE.slice(-5)}`;

// A valid 1×1 PNG: the server checks the file's real type, not its name.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.afterAll(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const user = data?.users.find((u) => u.email === `${PHONE}@${process.env.NEXT_PUBLIC_STAFF_EMAIL_DOMAIN ?? "cleanify.internal"}`);
  if (user) await admin.auth.admin.deleteUser(user.id);
});

test("new staff sign up, admin rejects, applicant sees why", async ({ page, browser }) => {
  await page.goto("/join");
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/\/join$/); // empty form goes nowhere

  await page.getByLabel("Full name").fill(NAME);
  await page.getByLabel("Mobile number").fill(PHONE);
  await page.getByLabel("Home address").fill("E2E Street, Hyderabad");
  await page.getByLabel("Choose a password").fill("E2eTest#2026");
  await page.locator("#j-aadhaar").setInputFiles({ name: "aadhaar.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page.locator("#j-second").setInputFiles({ name: "licence.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Create my account" }).click();
  await page.waitForURL(/\/join\/status/, { timeout: 30_000 });

  // A switched-off account cannot reach staff screens.
  await page.goto("/s");
  await expect(page).toHaveURL(/\/join\/status/);

  const admin = await pageAs(browser, "admin");
  await admin.goto("/admin/users");
  const card = admin.locator("section, li, article").filter({ hasText: NAME }).last();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Reject" }).click();
  await card.getByPlaceholder("Why? The applicant sees this.").fill("Aadhaar photo unreadable (e2e)");
  await card.getByRole("button", { name: /Send|Reject/ }).last().click();
  await expect(card.getByText("Rejected.")).toBeVisible();
  await admin.context().close();

  await page.reload();
  await expect(page.getByText("Aadhaar photo unreadable (e2e)")).toBeVisible();
});
