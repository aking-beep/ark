import { expect, test } from "@playwright/test";

test("landing, privacy, transparency, and scored sample", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /find the ai that fits you/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /find my fit/i })).toBeVisible();

  await page.getByRole("link", { name: "Privacy" }).first().click();
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
  await expect(page.getByText(/anonymous mode/i)).toBeVisible();

  await page.goto("/methodology");
  await expect(page.getByRole("heading", { name: "How it works", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /open the product and model registry/i })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: /see an example/i }).click();
  await expect(page.getByText(/Fit score/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1, name: /careful checker/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /save my ai setup/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /set up your apps/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /how you like to use ai/i })).toBeVisible();
  await expect(page.getByText(/paste into chatgpt/i).first()).toBeVisible();
});

test("assessment intro gate", async ({ page }) => {
  await page.goto("/assessment");
  await expect(page.getByRole("heading", { name: /find your ai fit/i })).toBeVisible();
  await expect(page.getByText(/about five minutes/i)).toBeVisible();
  await page.getByRole("button", { name: /let's go/i }).click();
  await expect(page.getByText(/scene 1/i)).toBeVisible();
});
