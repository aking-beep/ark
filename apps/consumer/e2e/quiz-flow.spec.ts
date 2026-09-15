import { expect, test } from "@playwright/test";

test("quiz shows how many questions and advances on click", async ({ page }) => {
  await page.route("**/v1/sessions/**/events", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    await route.continue();
  });

  await page.goto("/assessment");
  await expect(page.getByText(/four short scenes, about twelve questions/i)).toBeVisible();
  await page.getByRole("button", { name: /let's go/i }).click();

  await expect(page.getByText(/scene 1 of 4/i)).toBeVisible();
  await expect(page.getByText(/question 1 of about 12/i)).toBeVisible();
  await expect(page.getByText(/3 questions in this scene/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /continue/i })).toHaveCount(0);
  await expect(page.getByText(/no wrong answers/i)).toHaveCount(0);

  const prompt = page.locator("[data-slot=card-title]");
  const firstPrompt = (await prompt.innerText()).trim();
  expect(firstPrompt.length).toBeGreaterThan(8);

  await page.getByRole("radio").first().click();
  await expect(page.getByText(/question 2 of about 12/i)).toBeVisible({ timeout: 1_500 });
  await expect(prompt).not.toHaveText(firstPrompt);
  await expect(page.getByText(/^Saving/i)).toHaveCount(0);
});
