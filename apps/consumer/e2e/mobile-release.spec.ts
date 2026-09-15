import { expect, test } from "@playwright/test";

test("phone quiz advances on tap and shows length", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/assessment");
  await expect(page.getByText(/privacy note/i)).toBeVisible();
  await page.getByRole("button", { name: /let's go/i }).click();
  await expect(page.getByText(/scene 1 of 4/i)).toBeVisible();
  await expect(page.getByText(/question 1 of about 12/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /continue/i })).toHaveCount(0);
  await page.getByRole("radio").first().click();
  await expect(page.getByText(/question 2 of about 12/i)).toBeVisible({ timeout: 1500 });
});

test("phone results put Start here first and keep a compact header", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /see an example/i }).click();
  await expect(page.getByRole("heading", { name: /start here/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /use your persona now/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /copy my instructions/i })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  await page.getByRole("button", { name: /open menu/i }).click();
  await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();
  await expect(page.getByRole("link", { name: /privacy/i }).first()).toBeVisible();
});
