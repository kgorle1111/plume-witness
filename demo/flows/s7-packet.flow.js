const { hold, ready, next, glide } = require('./flow-lib.js');

// Shot 7 (1:45-2:00): tap "Next: Packet", "Español", "Read aloud" for about two seconds (the in-app Kokoro clip),
// "Approve this draft", then "File with regulator (you submit)". Ends on the "You file this yourself" dialog.
// The take has no sound (Playwright records picture only); the cut lays the app's own clip under the read-aloud.
// Pressing Español switches the whole page to Spanish, so every control after it is matched in either language.
module.exports = async (page) => {
  await ready(page);
  await next(page, 'Packet');
  await hold(page, 600);
  await page.getByRole('group', { name: 'Draft language' }).getByRole('button', { name: 'Español' }).click();
  await hold(page, 1600); // the Spanish draft, same numbers
  await page.getByRole('button', { name: /^(Read aloud|Leer en voz alta)$/ }).click();
  await hold(page, 2200);
  const stop = page.getByRole('button', { name: /^(Stop reading|Dejar de leer)$/ });
  if (await stop.isVisible().catch(() => false)) await stop.click();
  await hold(page, 500);
  await glide(page.locator('h3.list-heading').filter({ hasText: /Review and file|Revisar y presentar/ }), page, 900);
  await page.getByRole('button', { name: /^(Approve this draft|Aprobar este borrador)$/ }).click();
  await hold(page, 1500);
  await page.getByRole('button', { name: /^(File with regulator \(you submit\)|Presentar ante el regulador \(usted lo envía\))$/ }).click();
  await page.getByRole('heading', { name: /^(You file this yourself|Usted lo presenta por su cuenta)$/ }).waitFor({ timeout: 5000 });
  await hold(page, 4500); // end on the dialog; long enough for the last narration line to finish over it
};
