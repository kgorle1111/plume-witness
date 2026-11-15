const { hold, ready, tab, glide } = require('./flow-lib.js');

module.exports = async (page) => {
  await ready(page);
  await tab(page, 'Packet');
  await hold(page, 2000); // English draft
  await page.getByRole('button', { name: 'Español' }).click();
  await hold(page, 2000); // Spanish draft, same numbers
  await glide(page.locator('h3.list-heading').filter({ hasText: 'Review and file' }), page, 900);
  // Approve is press-and-hold (~1.1 s): hold the mouse on it, then let go once it has filled.
  await page.getByRole('button', { name: 'Approve this draft' }).hover();
  await page.mouse.down();
  await hold(page, 1400);
  await page.mouse.up();
  await hold(page, 1200);
  await page.getByRole('button', { name: 'File with regulator (you submit)' }).click();
  await hold(page, 2800); // "You file this yourself" dialog
  await page.getByRole('button', { name: 'Got it' }).click();
  await hold(page, 2500);
};
