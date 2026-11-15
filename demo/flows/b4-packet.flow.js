const { hold, ready, tab, glide } = require('./flow-lib.js');

// Pressing Español switches the whole page to Spanish, so every control after it is matched in either language.
module.exports = async (page) => {
  await ready(page);
  await tab(page, 'Packet');
  await hold(page, 2000); // English draft
  await page.getByRole('group', { name: 'Draft language' }).getByRole('button', { name: 'Español' }).click();
  await hold(page, 2000); // Spanish draft, same numbers
  await glide(page.locator('h3.list-heading').filter({ hasText: /Review and file|Revisar y presentar/ }), page, 900);
  await page.getByRole('button', { name: /^(Approve this draft|Aprobar este borrador)$/ }).click();
  await hold(page, 1800);
  await page.getByRole('button', { name: /^(File with regulator \(you submit\)|Presentar ante el regulador \(usted lo envía\))$/ }).click();
  await hold(page, 2800); // "You file this yourself" dialog
  await page.getByRole('button', { name: /^(Got it|Entendido)$/ }).click();
  await hold(page, 2500);
};
