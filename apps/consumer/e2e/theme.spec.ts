import { expect, test } from "@playwright/test";

test("theme toggle switches between light and dark", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");

  const toDark = page.getByRole("button", { name: /switch to dark theme/i });
  const toLight = page.getByRole("button", { name: /switch to light theme/i });

  // Whichever the current theme resolves to, exercise both directions.
  if (await toDark.count()) {
    await toDark.click();
    await expect(html).toHaveClass(/dark/);
    await toLight.click();
    await expect(html).not.toHaveClass(/dark/);
  } else {
    await toLight.click();
    await expect(html).not.toHaveClass(/dark/);
    await toDark.click();
    await expect(html).toHaveClass(/dark/);
  }
});
