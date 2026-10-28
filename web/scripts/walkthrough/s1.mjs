import * as L from "./lib.mjs";
const b = await L.launch();
const { page, issues } = await L.walletPage(b, process.env.ADMIN_PRIVATE_KEY, "admin");
for (const [p, n] of [["/", "01-landing"], ["/wire", "02-wire"]]) {
  const t0 = Date.now();
  await page.goto(L.BASE + p, { waitUntil: "networkidle", timeout: 90000 });
  await L.shot(page, n);
  console.log(p, Date.now() - t0, "ms", (await page.title()), (await page.innerText("body")).slice(0, 300).replace(/\s+/g, " "));
}
await page.getByRole("button", { name: "Connect wallet" }).first().click();
await page.waitForTimeout(1500);
await L.shot(page, "03-connect-click");
console.log((await page.innerText("body")).slice(0, 600).replace(/\s+/g, " "));
console.log(await page.locator("[role=dialog],[role=alertdialog]").allInnerTexts());
console.log(issues);
await b.close();
