// Le sitemap est un index (/sitemap.xml) de fichiers : cette fonction lit l'index puis chaque fichier et renvoie tout le texte.
async function fullSitemap(s) {
  const index = await s.request('GET', '/sitemap.xml');
  const files = [...index.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);
  const parts = [index.text];
  for (const f of files) parts.push((await s.request('GET', f)).text);
  return parts.join('\n');
}
module.exports = { fullSitemap };
