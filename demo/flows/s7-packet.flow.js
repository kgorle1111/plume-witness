const { hold, ready, next, glide } = require('./flow-lib.js');

// Shot 7 (1:45-2:00): tap "Next: Packet", "Español", "Read aloud" for about two seconds (the in-app Kokoro clip),
// "Approve this draft", then "File with regulator (you submit)". Ends on the "You file this yourself" dialog.
// The take has no sound (Playwright records picture only); the cut lays the app's own clip under the read-aloud.
module.exports = async (page) => {
  await ready(page);
  await next(page, 'Packet');
  await hold(page, 600);
  await page.getByRole('group', { name: 'Draft language' }).getByRole('button', { name: 'Español' }).click();
  await hold(page, 1600); // the Spanish draft, same numbers
  await page.getByRole('button', { name: 'Read aloud' }).click();
  await hold(page, 2200);
  const stop = page.getByRole('button', { name: 'Stop reading' });
  if (await stop.isVisible().catch(() => false)) await stop.click();
  await hold(page, 500);
  await glide(page.locator('h3.list-heading').filter({ hasText: 'Review and file' }), page, 900);
  await page.getByRole('button', { name: 'Approve this draft' }).click();
  await hold(page, 1500);
  await page.getByRole('button', { name: 'File with regulator (you submit)' }).click();
  await page.getByRole('heading', { name: 'You file this yourself' }).waitFor({ timeout: 5000 });
  await hold(page, 4500); // end on the dialog; long enough for the last narration line to finish over it
};
