import { expect, test } from "@playwright/test";

test("skip link and reading-level toggle are available", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /skip to content/i })).toBeAttached();
  const group = page.getByRole("group", { name: /reading level/i });
  await expect(group.getByRole("button", { name: "Simple" })).toBeVisible();
  await expect(group.getByRole("button", { name: "Detailed" })).toBeVisible();
});

test("results use plain language in Simple and expand the breakdown in Detailed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /see an example/i }).click();

  // Beginner-friendly "Start here" next steps and plain-language tool labels.
  await expect(page.getByRole("heading", { name: /start here/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /copy my instructions/i })).toBeVisible();
  await expect(page.getByText("Everyday helper").first()).toBeVisible();

  // Simple mode keeps the technical breakdown collapsed.
  const evidenceTab = page.getByRole("tab", { name: "Evidence" });
  await expect(evidenceTab).toBeHidden();

  // Switching to Detailed auto-expands the full breakdown.
  await page.getByRole("group", { name: /reading level/i }).getByRole("button", { name: "Detailed" }).click();
  await expect(evidenceTab).toBeVisible();
});
