// Crawl tin nha khoa (tieng Anh) + nghien cuu moi tu PubMed -> TinTuc/news.json
// Chay bang GitHub Actions, 4 lan/ngay, moi lan toi da 10 tin MOI. Khong can thu vien ngoai (Node 20+).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const OUT = 'TinTuc/news.json';
const PER_RUN = 10;      // tong so tin moi moi lan
const NEWS_N = 6;        // trong do: tin tu bao/website
const PUBMED_N = 4;      // va bai nghien cuu PubMed
const VN_N = 5;          // them toi da 5 tin trong nuoc (tieng Viet) moi lan
const KEEP = 1500;       // so tin giu lai toi da
const MAX_AGE_DAYS = 30; // bo qua tin cu hon
const UA = 'Mozilla/5.0 (compatible; RHM-DentalNewsBot/1.0; +https://github.com)';

// Nguon tin. Feed nao loi thi bo qua, log ghi ro nguon nao hong.
// region: 'intl' (quoc te, tieng Anh) | 'vn' (trong nuoc, tieng Viet). filter: chi giu bai co chua tu khoa nha khoa.
const VN_DENTAL = /răng|nha khoa|nha sĩ|nha sỹ|hàm mặt|niềng|implant|nướu|nha chu|sâu răng|tủy răng|cắm ghép|miệng/i;
export const SOURCES = [
  { name: 'ADA News',            region: 'intl', url: 'https://adanews.ada.org/feed/' },
  { name: 'Dental Tribune',      region: 'intl', url: 'https://www.dental-tribune.com/feed/' },
  { name: 'Dentistry Today',     region: 'intl', url: 'https://www.dentistrytoday.com/feed/' },
  { name: 'Dentistry.co.uk',     region: 'intl', url: 'https://dentistry.co.uk/feed/' },
  { name: 'British Dental Journal', region: 'intl', url: 'https://www.nature.com/bdj.rss' },
  { name: 'ScienceDaily',        region: 'intl', url: 'https://www.sciencedaily.com/rss/health_medicine/dentistry.xml' },
  { name: 'Medical Xpress',      region: 'intl', url: 'https://medicalxpress.com/rss-feed/dentistry-news/' },
  { name: 'NIDCR (NIH)',         region: 'intl', url: 'https://www.nidcr.nih.gov/news-events/news/rss.xml' },
  // Trong nuoc: cac muc Suc khoe cua bao lon, loc theo tu khoa nha khoa
  { name: 'VnExpress',           region: 'vn', filter: VN_DENTAL, url: 'https://vnexpress.net/rss/suc-khoe.rss' },
  { name: 'Tuổi Trẻ',            region: 'vn', filter: VN_DENTAL, url: 'https://tuoitre.vn/rss/suc-khoe.rss' },
  { name: 'Thanh Niên',          region: 'vn', filter: VN_DENTAL, url: 'https://thanhnien.vn/rss/suc-khoe.rss' },
  { name: 'Dân trí',             region: 'vn', filter: VN_DENTAL, url: 'https://dantri.com.vn/rss/suc-khoe.rss' },
  { name: 'VietNamNet',          region: 'vn', filter: VN_DENTAL, url: 'https://vietnamnet.vn/rss/suc-khoe.rss' },
  { name: 'Sức khỏe & Đời sống', region: 'vn', filter: VN_DENTAL, url: 'https://suckhoedoisong.vn/rss/home.rss' },
  // Du phong: Google News tieng Viet (ten bao lay tu the <source> cua tung bai)
  { name: 'Google News VN', region: 'vn', itemSource: true, url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('nha khoa OR "răng hàm mặt" OR "nha sĩ" when:7d') + '&hl=vi&gl=VN&ceid=VN:vi' },
];

const PUBMED_TERM =
  '(("Dentistry"[MeSH Terms] OR "Dental Implants"[MeSH Terms] OR "Periodontal Diseases"[MeSH Terms] OR ' +
  '"Tooth Diseases"[MeSH Terms] OR "Orthodontics"[MeSH Terms] OR "Endodontics"[MeSH Terms] OR ' +
  '"Dental Caries"[MeSH Terms] OR "Oral Surgical Procedures"[MeSH Terms] OR dental[Title] OR tooth[Title] OR ' +
  'teeth[Title] OR periodont*[Title] OR orthodont*[Title] OR endodont*[Title] OR "dental implant*"[Title] OR ' +
  'caries[Title] OR pulp*[Title]) AND hasabstract AND english[lang] AND ' +
  '("Journal Article"[pt] OR "Review"[pt] OR "Randomized Controlled Trial"[pt] OR "Clinical Trial"[pt] OR "Meta-Analysis"[pt]))';

/* ---------- tien ich ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
  return ENT[e.toLowerCase()] ?? m;
});
const unCdata = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const strip = s => decode(unCdata(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const trunc = (s, n) => s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
const tag = (x, name) => { const m = x.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i')); return m ? m[1] : ''; };
const attr = (x, name, a) => { const m = x.match(new RegExp('<' + name + '\\b[^>]*\\b' + a + '=["\']([^"\']+)["\']', 'i')); return m ? decode(m[1]) : ''; };
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

function cleanUrl(u) {
  try { const x = new URL(u.trim()); [...x.searchParams.keys()].forEach(k => /^(utm_|fbclid|gclid|mc_|ref$)/i.test(k) && x.searchParams.delete(k)); x.hash = ''; return x.toString(); }
  catch { return ''; }
}

async function get(url, accept = '*/*') {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: ctl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

/* ---------- RSS / Atom ---------- */
export function parseFeed(xml, source, opt = {}) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const out = [];
  for (const b of blocks) {
    let title = strip(tag(b, 'title'));
    let srcName = source;
    if (opt.itemSource) { const sn = strip(tag(b, 'source')); if (sn) { srcName = sn; title = title.replace(new RegExp('\\s*[-–|]\\s*' + sn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), ''); } }
    let link = strip(tag(b, 'link'));
    if (!/^https?:/i.test(link)) {
      const alt = b.match(/<link\b[^>]*rel=["']alternate["'][^>]*>/i) || b.match(/<link\b[^>]*>/i);
      link = alt ? attr(alt[0], 'link', 'href') : '';
    }
    if (!/^https?:/i.test(link)) link = strip(tag(b, 'guid'));
    link = cleanUrl(link);
    const dRaw = strip(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const ts = Date.parse(dRaw);
    const body = tag(b, 'content:encoded') || tag(b, 'description') || tag(b, 'summary') || tag(b, 'content');
    let summary = strip(body).replace(/\s*(The post|Read more|Continue reading).*$/i, '');
    let image = attr(b, 'media:content', 'url') || attr(b, 'media:thumbnail', 'url');
    if (!image) { const e = b.match(/<enclosure\b[^>]*>/i); if (e && /image/i.test(e[0])) image = attr(e[0], 'enclosure', 'url'); }
    if (!image) { const m = decode(unCdata(body)).match(/<img[^>]+src=["']([^"']+)["']/i); if (m) image = m[1]; }
    if (!title || !link || !ts) continue;
    out.push({
      id: 'n' + sha(link), type: 'news', region: opt.region || 'intl', title: trunc(title, 220), url: link, source: srcName,
      date: new Date(ts).toISOString(), summary: trunc(summary, 420),
      image: /^https?:/i.test(image) ? image : '',
    });
  }
  return out;
}

/* ---------- PubMed ---------- */
export function parsePubmed(xml) {
  const arts = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
  const out = [];
  for (const a of arts) {
    const pmid = (a.match(/<PMID[^>]*>(\d+)<\/PMID>/) || [])[1];
    const title = strip(tag(a, 'ArticleTitle'));
    if (!pmid || !title) continue;
    const abs = (a.match(/<AbstractText\b[^>]*>[\s\S]*?<\/AbstractText>/g) || []).map(t => {
      const lab = (t.match(/Label=["']([^"']+)["']/) || [])[1];
      const txt = strip(t);
      return lab && lab.toUpperCase() !== 'UNLABELLED' ? lab.charAt(0) + lab.slice(1).toLowerCase() + ': ' + txt : txt;
    }).join(' ');
    const journal = strip((a.match(/<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/) || [])[1] || '');
    const pd = a.match(/<PubMedPubDate PubStatus="pubmed">[\s\S]*?<Year>(\d+)<\/Year>[\s\S]*?<Month>(\d+)<\/Month>[\s\S]*?<Day>(\d+)<\/Day>/);
    const date = pd ? new Date(Date.UTC(+pd[1], +pd[2] - 1, +pd[3], 12)).toISOString() : new Date().toISOString();
    const authors = (a.match(/<Author\b[^>]*>[\s\S]*?<\/Author>/g) || []).map(x => { const l = tag(x, 'LastName'), i = tag(x, 'Initials'); return l ? strip(l) + (i ? ' ' + strip(i) : '') : ''; }).filter(Boolean);
    const doi = (a.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/) || [])[1] || '';
    out.push({
      id: 'pmid:' + pmid, type: 'research', region: 'intl', title: trunc(title, 260), url: 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/',
      source: 'PubMed' + (journal ? ' · ' + journal : ''), date,
      authors: authors.length > 3 ? authors.slice(0, 3).join(', ') + ', et al.' : authors.join(', '),
      doi, summary: trunc(abs, 700), image: '',
    });
  }
  return out;
}

async function fetchPubmed(log) {
  const key = process.env.NCBI_API_KEY ? '&api_key=' + process.env.NCBI_API_KEY : '';
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
  const s = await get(base + 'esearch.fcgi?db=pubmed&retmode=json&retmax=60&sort=pub_date&datetype=edat&reldate=21&tool=rhm-news&term=' + encodeURIComponent(PUBMED_TERM) + key);
  const ids = JSON.parse(s).esearchresult?.idlist || [];
  if (!ids.length) return [];
  const xml = await get(base + 'efetch.fcgi?db=pubmed&retmode=xml&tool=rhm-news&id=' + ids.join(',') + key);
  const items = parsePubmed(xml);
  log(`PubMed: ${ids.length} id, ${items.length} bai`);
  return items;
}

/* ---------- chon tin ---------- */
export function pickNews(cands, n) {            // xen ke giua cac nguon cho da dang
  const by = new Map();
  cands.sort((a, b) => b.date.localeCompare(a.date)).forEach(i => { if (!by.has(i.source)) by.set(i.source, []); by.get(i.source).push(i); });
  const out = []; const lists = [...by.values()];
  while (out.length < n && lists.some(l => l.length)) for (const l of lists) { if (l.length && out.length < n) out.push(l.shift()); }
  return out;
}

async function main() {
  const log = m => console.log(m);
  let db = { updated: 0, items: [] };
  try { db = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
  const have = new Set(db.items.map(i => i.id)); const haveUrl = new Set(db.items.map(i => i.url));
  const minTs = Date.now() - MAX_AGE_DAYS * 864e5;
  let okCount = 0;

  const news = [], vn = [];
  for (const s of SOURCES) {
    try {
      let items = parseFeed(await get(s.url, 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*'), s.name, s);
      if (s.filter) items = items.filter(i => s.filter.test((i.title + ' ' + i.summary).normalize('NFC')));
      const fresh = items.filter(i => !have.has(i.id) && !haveUrl.has(i.url) && Date.parse(i.date) >= minTs && Date.parse(i.date) <= Date.now() + 864e5);
      log(`OK   [${s.region}] ${s.name}: ${items.length} bai${s.filter ? ' (da loc nha khoa)' : ''}, ${fresh.length} moi`);
      (s.region === 'vn' ? vn : news).push(...fresh); okCount++;
    } catch (e) { log(`LOI  [${s.region}] ${s.name}: ${e.message}`); }
  }
  let pub = [];
  try { pub = (await fetchPubmed(log)).filter(i => !have.has(i.id)); okCount++; } catch (e) { log(`LOI  PubMed: ${e.message}`); }
  pub.sort((a, b) => b.date.localeCompare(a.date));

  const dedupe = arr => { const seen = new Set(); return arr.filter(i => (seen.has(i.url) ? false : seen.add(i.url))); };
  const nAll = dedupe(news);
  let pickedN = pickNews(nAll.slice(), NEWS_N), pickedP = pub.slice(0, PUBMED_N);
  // thieu o ben nao thi lay bu tu ben kia cho du 10
  let short = PER_RUN - pickedN.length - pickedP.length;
  if (short > 0) {
    const restP = pub.slice(pickedP.length, pickedP.length + short);
    pickedP = pickedP.concat(restP); short -= restP.length;
    if (short > 0) { const left = nAll.filter(i => !pickedN.includes(i)); pickedN = pickedN.concat(pickNews(left, short)); }
  }
  const pickedV = pickNews(dedupe(vn), VN_N);
  const picked = [...pickedN, ...pickedP, ...pickedV].sort((a, b) => b.date.localeCompare(a.date));
  const now = Date.now();
  picked.forEach(i => { i.crawled = now; });
  log(`Chon ${picked.length} tin moi (${pickedN.length} quoc te, ${pickedP.length} nghien cuu, ${pickedV.length} trong nuoc)`);

  if (!okCount) { console.error('Tat ca nguon deu loi'); process.exit(1); }
  if (!picked.length) { log('Khong co tin moi, khong ghi file.'); return; }

  db.items = [...picked, ...db.items].sort((a, b) => b.date.localeCompare(a.date)).slice(0, KEEP);
  db.updated = now;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(db, null, 1) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
