import { expect, test, type Page } from "@playwright/test";
import { db, go, istSlot, istToday, pageAs, takePhoto, TEST_NOTE } from "./helpers";

/**
 * One supervisor's whole day, driven through the real screens:
 * sales books → supervisor checks in → sales approves → reached → before
 * photos (rejected once, then approved) → cleaning → after photos → admin
 * closes the job → check-out → admin dashboard shows the km.
 *
 * A supervisor checks in once per day, so this runs once per day per database.
 */
const DEPOT = {
  latitude: Number(process.env.SEED_DEPOT_LAT ?? 17.4401),
  longitude: Number(process.env.SEED_DEPOT_LNG ?? 78.3489),
  accuracy: 10,
};
const SITE = { latitude: 17.441, longitude: 78.35, accuracy: 10 };
const CLIENT = `E2E Client ${Date.now()}`;

test.describe.configure({ mode: "serial", timeout: 15 * 60_000 });

/**
 * Lets the test run more than once a day: undoes the TEST supervisor's
 * check-in/out for today only. Photos are kept, marked replaced, exactly as a
 * retake in the app would leave them.
 */
async function resetRaviToday() {
  const where = `supervisor_id = (select id from auth.users where email = 'ravi@cleanify.internal')
                 and roster_date = $1`;
  await db(
    `update photos set replaced_at = now()
      where replaced_at is null and roster_id in (select id from day_rosters where ${where})`,
    [istToday()],
  );
  await db(
    `update day_rosters set submitted_at = null, client_reported_at = null, checkin_status = null,
            approval_status = 'PENDING', approved_by = null, approved_at = null, rejection_reason = null,
            flags = '{}', risk_score = 0, location = null, accuracy_m = null, distance_from_expected_m = null,
            start_odometer_km = null, end_odometer_km = null, checked_out_at = null,
            checkout_location = null, checkout_accuracy_m = null
      where ${where}`,
    [istToday()],
  );
}

/** Approval cards leave the page once decided, so the outcome is read from the database. */
async function expectDb(sql: string, params: unknown[], value: unknown) {
  await expect
    .poll(async () => Object.values((await db(sql, params))[0] ?? {})[0], { timeout: 20_000 })
    .toBe(value);
}

test("a full working day, booking to check-out", async ({ browser }) => {
  await resetRaviToday();

  const slot = istSlot(90);
  test.skip(slot.date !== istToday(), "too late in the IST day to book a job for today");

  const priya = await pageAs(browser, "priya");
  const ravi = await pageAs(browser, "ravi", { geolocation: DEPOT });
  const admin = await pageAs(browser, "admin");
  let jobId = "";

  await test.step("sales books a water tank job for today", async () => {
    await go(priya, "/sales/new");
    await priya.getByRole("button", { name: "New client" }).click();
    await priya.getByLabel("Client name").fill(CLIENT);
    await priya.getByLabel("Phone").fill("9000000777");
    await priya.getByLabel("Address", { exact: false }).first().fill("Plot 12, E2E Street, Hyderabad");
    await priya.getByRole("button", { name: "Continue" }).click();

    await priya.getByPlaceholder("maps.app.goo.gl/… or 17.4401, 78.3489").fill(`${SITE.latitude.toFixed(4)}, ${SITE.longitude.toFixed(4)}`);
    await expect(priya.getByText("Pin moved to the shared location")).toBeVisible();
    await priya.getByRole("button", { name: "Continue" }).click();

    await priya.getByRole("button", { name: /Water Tank Cleaning/ }).click();
    await priya.getByRole("button", { name: "Continue" }).click().catch(() => {});

    await priya.getByRole("button", { name: "1", exact: true }).click();
    await priya.getByLabel("Capacity").fill("1000");
    await priya.getByLabel("Tank type").selectOption({ label: "Synthetic" });
    await priya.getByLabel("Where is it?").selectOption({ label: "Overhead / terrace" });
    await priya.getByLabel("On a stand or on the terrace floor?").selectOption({ label: "On a stand" });
    await priya.getByRole("button", { name: "Continue" }).click();

    await priya.getByLabel("Date").fill(slot.date);
    await priya.getByLabel("Start time").fill(slot.time);
    await priya.getByLabel("Supervisor").selectOption({ label: "Ravi (Supervisor)" });
    await priya.getByLabel("Quoted amount (₹)").fill("1500");
    await priya.getByLabel("Internal notes").fill(TEST_NOTE);
    await priya.getByRole("button", { name: "Continue" }).click();

    await expect(priya.getByText(CLIENT)).toBeVisible();
    await priya.getByRole("button", { name: "Create job" }).click();
    await expect(priya.getByText(/Job .+ created/)).toBeVisible({ timeout: 30_000 });

    const [job] = await db<{ id: string }>(
      `select j.id from jobs j join clients c on c.id = j.client_id where c.name = $1`,
      [CLIENT],
    );
    jobId = job.id;
    expect(jobId).toBeTruthy();
  });

  await test.step("the job stays locked until the supervisor checks in", async () => {
    await go(ravi, `/s/jobs/${jobId}`);
    await expect(ravi.getByText(/Check in at the depot first|Waiting for your check-in/)).toBeVisible();
    await expect(ravi.getByRole("button", { name: "I've reached the site" })).toHaveCount(0);
  });

  await test.step("supervisor checks in with selfie, km photo and km reading", async () => {
    await go(ravi, "/s/checkin");
    const check = ravi.getByRole("button", { name: "Check in", exact: true });
    await expect(check).toBeDisabled();
    await ravi.getByRole("listitem").filter({ hasText: "Selfie" }).getByRole("button", { name: "Take photo" }).click();
    await takePhoto(ravi);
    await ravi.getByRole("listitem").filter({ hasText: "Scooter km reading" }).getByRole("button", { name: "Take photo" }).click();
    await takePhoto(ravi);
    await expect(check).toBeDisabled(); // km still missing
    await ravi.getByPlaceholder("e.g. 12450").fill("12450");
    await check.click();
    await expect(ravi.getByText("Photos sent for approval")).toBeVisible({ timeout: 30_000 });
  });

  await test.step("sales approves the depot check-in", async () => {
    await go(priya, "/sales/approvals");
    const card = priya.locator("section").filter({ hasText: "Ravi" }).filter({ has: priya.getByRole("button", { name: "Approve", exact: true }) });
    await expect(card.getByRole("img", { name: "Selfie" })).toBeVisible();
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await expectDb(
      `select approval_status::text from day_rosters
        where supervisor_id = (select id from auth.users where email = 'ravi@cleanify.internal') and roster_date = $1`,
      [istToday()],
      "APPROVED",
    );
  });

  await test.step("supervisor reaches the site and sends a before photo", async () => {
    await ravi.context().setGeolocation(SITE);
    await go(ravi, `/s/jobs/${jobId}`);
    await ravi.getByRole("button", { name: "I've reached the site" }).click();
    await expect(ravi.getByText(/take a before photo/)).toBeVisible();
    await ravi.waitForLoadState("networkidle"); // same re-key bug as after "Start cleaning"
    const send = ravi.getByRole("button", { name: "Send for approval" });
    await expect(send).toBeDisabled();
    await ravi.getByRole("button", { name: "Photo", exact: true }).click();
    await takePhoto(ravi);
    await send.click();
    await expect(ravi.getByText("Before photos sent")).toBeVisible();
  });

  await test.step("sales rejects the before photo with a reason", async () => {
    await go(priya, "/sales/approvals");
    const card = priya.locator("section").filter({ hasText: CLIENT });
    await card.getByRole("button", { name: "Reject" }).click();
    await card.getByPlaceholder("What needs fixing?").fill("Tank lid not visible, retake please");
    await card.getByRole("button", { name: "Send rejection" }).click();
    await expectDb(`select before_review::text from jobs where id = $1`, [jobId], "REJECTED");
  });

  await test.step("supervisor sees the reason, retakes and resends", async () => {
    await ravi.reload();
    await expect(ravi.getByText("Tank lid not visible, retake please")).toBeVisible();
    await ravi.getByRole("button", { name: "Retake" }).click();
    await takePhoto(ravi);
    await ravi.getByRole("button", { name: "Send for approval" }).click();
    await expect(ravi.getByText("Before photos sent")).toBeVisible();
  });

  await test.step("sales approves the before photo; supervisor starts cleaning", async () => {
    await go(priya, "/sales/approvals");
    const card = priya.locator("section").filter({ hasText: CLIENT });
    await card.getByRole("button", { name: "Approve, start cleaning" }).click();
    await expectDb(`select before_review::text from jobs where id = $1`, [jobId], "APPROVED");

    await ravi.reload();
    await ravi.getByRole("button", { name: "Start cleaning" }).click();
    await expect(ravi.getByText(/take its after photo/)).toBeVisible();
    // BUG (reported): a photo taken before this background refresh lands is
    // wiped from the screen, because the page re-keys JobFlow on job status.
    await ravi.waitForLoadState("networkidle");
  });

  await test.step("supervisor sends the after photo", async () => {
    await ravi.getByRole("button", { name: "Photo", exact: true }).click();
    await takePhoto(ravi);
    await ravi.getByRole("textbox").fill("1 tank cleaned and disinfected (e2e)");
    await ravi.getByRole("button", { name: "Send for approval" }).click();
    await expect(ravi.getByText("After photos sent for approval")).toBeVisible();
  });

  await test.step("admin sees before and after side by side and closes the job", async () => {
    await go(admin, "/sales/approvals");
    const card = admin.locator("section").filter({ hasText: CLIENT });
    await expect(card.getByRole("img", { name: "Before" })).toBeVisible();
    await expect(card.getByRole("img", { name: "After" })).toBeVisible();
    await card.getByRole("button", { name: "Approve and close job" }).click();
    await expectDb(`select status::text from jobs where id = $1`, [jobId], "COMPLETED");

    await ravi.reload();
    await expect(ravi.getByText("Job completed")).toBeVisible();
    const [row] = await db<{ status: string }>(`select status from jobs where id = $1`, [jobId]);
    expect(row.status).toBe("COMPLETED");
  });

  await test.step("check-out refuses a km reading below the morning's", async () => {
    await ravi.context().setGeolocation(DEPOT);
    await go(ravi, "/s/checkout");
    await ravi.getByRole("listitem").filter({ hasText: "Selfie" }).getByRole("button", { name: "Take photo" }).click();
    await takePhoto(ravi);
    await ravi.getByRole("listitem").filter({ hasText: "Scooter km reading" }).getByRole("button", { name: "Take photo" }).click();
    await takePhoto(ravi);
    await ravi.getByPlaceholder("e.g. 12450").fill("12400");
    const out = ravi.getByRole("button", { name: "Check out", exact: true });
    if (await out.isEnabled()) {
      await out.click();
      await expect(ravi.getByText(/lower than this morning/)).toBeVisible();
    }
  });

  await test.step("supervisor checks out with 25 km driven", async () => {
    await ravi.getByPlaceholder("e.g. 12450").fill("12475");
    await expect(ravi.getByText("25 km today")).toBeVisible();
    await ravi.getByRole("button", { name: "Check out", exact: true }).click();
    await expect(ravi.getByText("Checked out. Have a good evening.")).toBeVisible({ timeout: 30_000 });
  });

  await test.step("admin dashboard shows the day", async () => {
    await go(admin, "/admin");
    await expect(admin.getByText(/Ravi/).first()).toBeVisible();
    await expect(admin.getByText(/25(\.0)? km/).first()).toBeVisible();
  });

  await test.step("a second check-in today is refused", async () => {
    await go(ravi, "/s/checkin");
    await expect(ravi.getByText(/Check-in approved|Waiting for approval/)).toBeVisible();
  });

  for (const p of [priya, ravi, admin] as Page[]) await p.context().close();
});
