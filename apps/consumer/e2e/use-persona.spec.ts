import { expect, test } from "@playwright/test";

test("results offer a 'Use your persona now' hand-off", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /see an example/i }).click();

  const section = page.getByRole("heading", { name: /use your persona now/i });
  await expect(section).toBeVisible();

  // Send-to targets are present.
  const group = page.getByRole("group", { name: /choose an ai/i });
  await expect(group.getByRole("button", { name: "ChatGPT" })).toBeVisible();
  await expect(group.getByRole("button", { name: "Claude" })).toBeVisible();

  // Actions are disabled until there is a task, then enabled after typing.
  const copyBtn = page.getByRole("button", { name: /copy primed message/i });
  await expect(copyBtn).toBeDisabled();
  await page.getByLabel(/what do you need help with/i).fill("Draft a friendly reply to this email.");
  await expect(copyBtn).toBeEnabled();

  // Headless browsers often block the clipboard; we then show a copy box.
  await copyBtn.click();
  await expect(
    page.getByRole("button", { name: /copied message/i }).or(page.getByRole("dialog", { name: /copy primed message/i })),
  ).toBeVisible();
});
