// Crawl tin nha khoa/RHM (quoc te + trong nuoc) + nghien cuu PubMed -> TinTuc/news.json
// + noi dung bai (che do doc trong app) -> TinTuc/a/<id>.json
// Chay bang GitHub Actions, khong can thu vien ngoai (Node 20+).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const OUT = 'TinTuc/news.json';
const ART_DIR = 'TinTuc/a';
const PER_RUN = Infinity;       // quoc te: tong so tin moi moi lan
const NEWS_N = Infinity;        //   - trong do tin tu bao/website
const RESEARCH_N = Infinity;     //   - va bai nghien cuu (PubMed + tap chi)
const VN_N = 10;           // trong nuoc: toi da 10 tin moi moi lan
const VN_AGE_DAYS = 30;   // trong nuoc: chi lay bai trong 1 thang gan nhat
const KEEP = 5000;        // so tin giu lai trong news.json
const ART_KEEP = 2000;     // chi giu noi dung bai cua 400 tin moi nhat
const MAX_AGE_DAYS = +(process.env.NEWS_MAX_AGE_DAYS || 365);
const SCRAPE_PER_SITE = 60;
const FULLTEXT = process.env.NEWS_FULLTEXT !== '0'; // dat NEWS_FULLTEXT=0 de chi luu tom tat, khong luu toan van
const UA = process.env.NEWS_UA || 'Mozilla/5.0 (compatible; RHM-DentalNewsBot/1.0; +https://github.com)';

const VN_DENTAL = /răng|nha khoa|nha sĩ|nha sỹ|nha chu|nội nha|chỉnh nha|hàm mặt|răng hàm mặt|RHM|niềng|implant|cấy ghép|cắm ghép|nướu|lợi|viêm lợi|tủy|miệng|nhiệt miệng|bọc sứ|phục hình|trám|nhổ|tiểu phẫu|xương hàm|phẫu thuật hàm|thái dương hàm|khớp cắn|hàm giả|mắc cài|veneer|tẩy trắng|dental|dentist|orthodont|odontolog|maxillofacial/i;
const EN_CMF = /maxillofacial|craniofacial|\bcmf\b|mandib|maxill|jaw|dental|dentist|\boral\b|cleft/i;   // nguon phau thuat tong quat: chi lay bai lien quan ham mat

/* ---------------------------------------------------------------------------
 QUY TAC CRAWL (theo 2 file huong dan: nha_khoa_quoc_te.md + nha_khoa_viet_nam.md)
  1. CHI lay tu cac nguon co ten trong file huong dan (GUIDE_SOURCES). Nguon ngoai huong dan
     (bao lon, Google News, ScienceDaily...) nam o EXTRA_SOURCES va chi chay khi dat NEWS_EXTRA=1.
  2. Moi nguon thuoc 1 nhom (group) dung theo muc trong file huong dan.
  3. Nguon khong co RSS -> quet link, NHUNG moi bai phai duoc mo ra kiem tra:
       - co ngay xuat ban that trong trang (khong co ngay -> bo, khong tu gan "hom nay"),
       - ngay nam trong MAX_AGE_DAYS, co tieu de + noi dung toi thieu,
       - nguon tong hop (Bo Y te, truong, tap chi YHVN, AO Foundation...) phai khop tu khoa nha khoa/ham mat.
  4. Khong luu bai trung URL hoac trung tieu de voi bai da co.
  Moi nguon: { name, region:'intl'|'vn', kind:'news'|'journal', group, feed?, site?, filter? }
  Nguon nao loi chi bi bo qua + ghi log (dong LOI), khong lam hong ca lan chay.
--------------------------------------------------------------------------- */
const G = {
  NEWS: 'Tin tức & thương mại', ASSOC: 'Hiệp hội', JOURNAL: 'Tạp chí khoa học', DB: 'Cơ sở dữ liệu', EVENT: 'Sự kiện',
  GOV: 'Cơ quan quản lý', VJOURNAL: 'Tạp chí học thuật', VASSOC: 'Hội chuyên khoa', UNI: 'Trường đại học', HOSP: 'Bệnh viện',
};
const GUIDE_SOURCES = [
  // ===== QUOC TE - muc 4: tin tuc / thuong mai =====
  { name: 'Dental Tribune',         region: 'intl', kind: 'news', group: G.NEWS, feed: 'https://www.dental-tribune.com/feed/', site: 'https://www.dental-tribune.com/' },
  { name: 'Inside Dentistry',       region: 'intl', kind: 'news', group: G.NEWS, site: 'https://www.insidedentistry.net/' },
  { name: 'Dental Update',          region: 'intl', kind: 'news', group: G.NEWS, site: 'https://www.dental-update.co.uk/' },
  { name: 'DentistryIQ',            region: 'intl', kind: 'news', group: G.NEWS, site: 'https://www.dentistryiq.com/' },
  { name: 'Dentaltown',             region: 'intl', kind: 'news', group: G.NEWS, site: 'https://www.dentaltown.com/' },
  { name: 'Dentistry Today',        region: 'intl', kind: 'news', group: G.NEWS, feed: 'https://www.dentistrytoday.com/feed/', site: 'https://www.dentistrytoday.com/' },
  { name: 'Dentistry.co.uk',        region: 'intl', kind: 'news', group: G.NEWS, feed: 'https://dentistry.co.uk/feed/', site: 'https://dentistry.co.uk/' },
  // ===== QUOC TE - muc 2: hiep hoi / to chuc =====
  { name: 'ADA News',               region: 'intl', kind: 'news', group: G.ASSOC, feed: 'https://adanews.ada.org/feed/', site: 'https://adanews.ada.org/' },
  { name: 'FDI World Dental Federation', region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://www.fdiworlddental.org/news' },
  { name: 'IADR',                   region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://www.iadr.org/news' },
  { name: 'ADEE',                   region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://adee.org/' },
  { name: 'ITI',                    region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://www.iti.org/' },
  { name: 'EAO',                    region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://www.eao.org/' },
  { name: 'Academy of Osseointegration', region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://www.osseo.org/' },
  { name: 'WFO (Orthodontists)',    region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://www.wfo.org/' },
  { name: 'AAO (Orthodontists)',    region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://www.aaoinfo.org/' },
  { name: 'IAOMS',                  region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://www.iaoms.org/' },
  { name: 'AAOMS',                  region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://www.aaoms.org/' },
  { name: 'AO Foundation (CMF)',    region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://www.aofoundation.org/', filter: EN_CMF },
  { name: 'EFP',                    region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://www.efp.org/news/' },
  { name: 'AAP (Periodontology)',   region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://www.perio.org/' },
  { name: 'AAE',                    region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://www.aae.org/' },
  { name: 'APDF / APRO',           region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://apdfapro.org/' },
  { name: 'ICP (Prosthodontists)',  region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://icp-org.com/' },
  { name: 'EOS (Orthodontic Society)', region: 'intl', kind: 'news', group: G.ASSOC, site: 'https://www.eoseurope.org/' },
  // NIDCR (NIH): vien nghien cuu nha khoa nha nuoc My -> nhom Co quan quan ly
  { name: 'NIDCR (NIH)',            region: 'intl', kind: 'news', group: G.GOV, feed: 'https://www.nidcr.nih.gov/news-events/news/rss.xml', site: 'https://www.nidcr.nih.gov/news-events/nidcr-news' },
  // ===== QUOC TE - muc 1: co so du lieu (PubMed lay rieng o duoi) =====
  { name: 'Cochrane Oral Health',   region: 'intl', kind: 'journal', group: G.DB, site: 'https://oralhealth.cochrane.org/' },
  // ===== QUOC TE - muc 3: tap chi khoa hoc (RSS muc luc moi nhat) =====
  { name: 'J Dent Res (JDR)',       region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://journals.sagepub.com/action/showFeed?ui=0&mi=ehikzz&ai=2b4&jc=jdrb&type=etoc&feed=rss' },
  { name: 'JADA',                   region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://jada.ada.org/current.rss' },
  { name: 'Clin Oral Implants Res', region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://onlinelibrary.wiley.com/feed/16000501/most-recent' },
  { name: 'AJODO',                  region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://www.ajodo.org/current.rss' },
  { name: 'J Clin Periodontol',     region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://onlinelibrary.wiley.com/feed/1600051X/most-recent' },
  { name: 'J Endodontics (JOE)',    region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://www.jendodon.com/current.rss' },
  { name: 'J Prosthet Dent (JPD)',  region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://www.thejpd.org/current.rss' },
  { name: 'Int J Oral Maxillofac Surg', region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://www.ijoms.com/current.rss' },
  { name: 'British Dental Journal', region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://www.nature.com/bdj.rss', site: 'https://www.nature.com/bdj/' },
  // --- ScienceDirect (Elsevier): RSS theo tung tap chi, URL = rss.sciencedirect.com/publication/science/<ISSN khong gach> ---
  { name: 'J Dent (ScienceDirect)',        region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://rss.sciencedirect.com/publication/science/03005712' },
  { name: 'Dental Materials (ScienceDirect)', region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://rss.sciencedirect.com/publication/science/01095641' },
  { name: 'Arch Oral Biol (ScienceDirect)', region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://rss.sciencedirect.com/publication/science/00039969' },
  { name: 'J Oral Maxillofac Surg (ScienceDirect)', region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://rss.sciencedirect.com/publication/science/02782391' },
  // --- Wiley Online Library: feed theo eISSN (bo dau gach) ---
  { name: 'J Periodontol (Wiley)',         region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://onlinelibrary.wiley.com/feed/19433670/most-recent' },
  { name: 'Int Endod J (Wiley)',           region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://onlinelibrary.wiley.com/feed/13652591/most-recent' },
  { name: 'Periodontology 2000 (Wiley)',   region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://onlinelibrary.wiley.com/feed/16000757/most-recent' },
  { name: 'Clin Implant Dent Relat Res (Wiley)', region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://onlinelibrary.wiley.com/feed/17088208/most-recent' },
  { name: 'J Oral Rehabil (Wiley)',        region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://onlinelibrary.wiley.com/feed/13652842/most-recent' },
  { name: 'Community Dent Oral Epidemiol (Wiley)', region: 'intl', kind: 'journal', group: G.JOURNAL, feed: 'https://onlinelibrary.wiley.com/feed/16000528/most-recent' },
  // --- SpringerLink: RSS ket qua tim kiem moi nhat ---
  { name: 'SpringerLink (dentistry)',      region: 'intl', kind: 'journal', group: G.DB, feed: 'https://link.springer.com/search.rss?query=dentistry&sortOrder=newestFirst' },
  { name: 'SpringerLink (dental implant)', region: 'intl', kind: 'journal', group: G.DB, feed: 'https://link.springer.com/search.rss?query=%22dental+implant%22&sortOrder=newestFirst' },
  { name: 'SpringerLink (orthodontics)',   region: 'intl', kind: 'journal', group: G.DB, feed: 'https://link.springer.com/search.rss?query=orthodontics&sortOrder=newestFirst' },
  // ResearchGate: tam an (GitHub Actions bi chan 403). Bo comment neu co proxy.
  // { name: 'ResearchGate',                  region: 'intl', kind: 'journal', group: G.DB, site: 'https://www.researchgate.net/topic/Dentistry', filter: EN_CMF },
  { name: 'Int J Oral Maxillofac Implants (IJOMI)', region: 'intl', kind: 'journal', group: G.JOURNAL, site: 'https://www.quintessence-publishing.com/usa/en/journal/the-international-journal-of-oral-maxillofacial-implants' },
  // ===== QUOC TE - muc 5: trien lam / dai hoi =====
  { name: 'IDS Cologne',            region: 'intl', kind: 'news', group: G.EVENT, site: 'https://www.english.ids-cologne.de/' },
  { name: 'GNYDM',                  region: 'intl', kind: 'news', group: G.EVENT, site: 'https://www.gnydm.com/' },
  { name: 'AEEDC Dubai',            region: 'intl', kind: 'news', group: G.EVENT, site: 'https://www.aeedc.com/' },
  { name: 'EuroPerio',              region: 'intl', kind: 'news', group: G.EVENT, site: 'https://www.efp.org/europerio/' },
  { name: 'Chicago Midwinter Meeting', region: 'intl', kind: 'news', group: G.EVENT, site: 'https://www.cds.org/' },

  // ===== VIET NAM - muc 1: co quan quan ly nha nuoc =====
  { name: 'Bộ Y tế',                region: 'vn', kind: 'news', group: G.GOV, site: 'https://moh.gov.vn/', filter: VN_DENTAL },
  { name: 'Cục Quản lý KCB',        region: 'vn', kind: 'news', group: G.GOV, site: 'https://kcb.vn/', filter: VN_DENTAL },
  // ===== VIET NAM - muc 2: tap chi hoc thuat =====
  { name: 'Tạp chí Răng Hàm Mặt VN', region: 'vn', kind: 'journal', group: G.VJOURNAL, site: 'https://vdj.vn/' },
  { name: 'Tạp chí Y học Việt Nam', region: 'vn', kind: 'journal', group: G.VJOURNAL, site: 'https://tapchiyhocvietnam.vn/', filter: VN_DENTAL },
  { name: 'Tạp chí Y học TP.HCM',   region: 'vn', kind: 'journal', group: G.VJOURNAL, site: 'https://tapchiyhoctphcm.vn/', filter: VN_DENTAL },
  { name: 'Tạp chí Nghiên cứu Y học', region: 'vn', kind: 'journal', group: G.VJOURNAL, site: 'https://tcncyh.vn/', filter: VN_DENTAL },
  { name: 'Tạp chí Y Dược học Cần Thơ', region: 'vn', kind: 'journal', group: G.VJOURNAL, site: 'https://tapchi.ctump.edu.vn/', filter: VN_DENTAL },
  { name: 'Tạp chí Y Dược Huế',     region: 'vn', kind: 'journal', group: G.VJOURNAL, site: 'https://jmp.huemed-univ.edu.vn/', filter: VN_DENTAL },
  // ===== VIET NAM - muc 3: hoi chuyen khoa =====
  { name: 'Hội RHM Việt Nam (VOSA)', region: 'vn', kind: 'news', group: G.VASSOC, site: 'https://vosa.org.vn/' },
  { name: 'Hội RHM TP.HCM (HOSA)',  region: 'vn', kind: 'news', group: G.VASSOC, site: 'https://hoiranghammat.vn/' },
  { name: 'HSDI (Cấy ghép Nha khoa TP.HCM)', region: 'vn', kind: 'news', group: G.VASSOC, site: 'https://implanthcm.com/' },
  // ===== VIET NAM - hoi nghi / trien lam (VIDEC do VOSA to chuc) =====
  { name: 'VIDEC',                  region: 'vn', kind: 'news', group: G.EVENT, site: 'https://videc.vn/' },
  { name: 'HIDEC',                  region: 'vn', kind: 'news', group: G.EVENT, site: 'https://hidec.vn/' },
  { name: 'HAIDEC',                 region: 'vn', kind: 'news', group: G.EVENT, site: 'https://haidec.vn/' },
  // ===== VIET NAM - muc 4: truong dai hoc y duoc =====
  { name: 'Viện Đào tạo RHM - ĐH Y Hà Nội', region: 'vn', kind: 'news', group: G.UNI, site: 'https://sod.hmu.edu.vn/' },
  { name: 'ĐH Y Dược Huế',          region: 'vn', kind: 'news', group: G.UNI, site: 'https://huemed-univ.edu.vn/', filter: VN_DENTAL },
  { name: 'ĐH Y Dược Cần Thơ',      region: 'vn', kind: 'news', group: G.UNI, site: 'https://ctump.edu.vn/', filter: VN_DENTAL },
  { name: 'ĐH Y khoa Phạm Ngọc Thạch', region: 'vn', kind: 'news', group: G.UNI, site: 'https://pnt.edu.vn/', filter: VN_DENTAL },
  { name: 'Khoa RHM - ĐH Y Dược TP.HCM', region: 'vn', kind: 'news', group: G.UNI, site: 'https://dent.ump.edu.vn/', filter: VN_DENTAL },
  { name: 'ĐH Y Dược Hải Phòng',    region: 'vn', kind: 'news', group: G.UNI, site: 'https://hpmu.edu.vn/', filter: VN_DENTAL },
  { name: 'ĐH Y Dược Thái Bình',    region: 'vn', kind: 'news', group: G.UNI, site: 'https://tbump.edu.vn/', filter: VN_DENTAL },
  { name: 'Khoa Y Dược - ĐH Đà Nẵng', region: 'vn', kind: 'news', group: G.UNI, site: 'https://smp.udn.vn/', filter: VN_DENTAL },
  { name: 'ĐH Quốc tế Hồng Bàng',   region: 'vn', kind: 'news', group: G.UNI, site: 'https://hiu.vn/', filter: VN_DENTAL },
  { name: 'ĐH Nguyễn Tất Thành',    region: 'vn', kind: 'news', group: G.UNI, site: 'https://ntt.edu.vn/', filter: VN_DENTAL },
  // ===== VIET NAM - muc 5: benh vien tuyen dau =====
  { name: 'BV RHM Trung ương TP.HCM', region: 'vn', kind: 'news', group: G.HOSP, site: 'https://benhvienranghammat.vn/' },
  { name: 'BV RHM Trung ương Hà Nội', region: 'vn', kind: 'news', group: G.HOSP, site: 'https://nhos.org.vn/' },
  { name: 'BV RHM TP.HCM',          region: 'vn', kind: 'news', group: G.HOSP, site: 'https://bvranghammat.com/' },
];

// Ngoai huong dan: mac dinh TAT. Bat bang bien moi truong NEWS_EXTRA=1 neu muon them bao lon / tong hop.
const EXTRA_SOURCES = [
  { name: 'ScienceDaily',           region: 'intl', kind: 'news', group: 'Khác', feed: 'https://www.sciencedaily.com/rss/health_medicine/dentistry.xml' },
  { name: 'Medical Xpress',         region: 'intl', kind: 'news', group: 'Khác', feed: 'https://medicalxpress.com/rss-feed/dentistry-news/' },
  { name: 'VnExpress',              region: 'vn', kind: 'news', group: 'Khác', feed: 'https://vnexpress.net/rss/suc-khoe.rss', filter: VN_DENTAL },
  { name: 'Tuổi Trẻ',               region: 'vn', kind: 'news', group: 'Khác', feed: 'https://tuoitre.vn/rss/suc-khoe.rss', filter: VN_DENTAL },
  { name: 'Thanh Niên',             region: 'vn', kind: 'news', group: 'Khác', feed: 'https://thanhnien.vn/rss/suc-khoe.rss', filter: VN_DENTAL },
  { name: 'Dân trí',                region: 'vn', kind: 'news', group: 'Khác', feed: 'https://dantri.com.vn/rss/suc-khoe.rss', filter: VN_DENTAL },
  { name: 'VietNamNet',             region: 'vn', kind: 'news', group: 'Khác', feed: 'https://vietnamnet.vn/rss/suc-khoe.rss', filter: VN_DENTAL },
  { name: 'Sức khỏe & Đời sống',    region: 'vn', kind: 'news', group: 'Khác', feed: 'https://suckhoedoisong.vn/rss/home.rss', filter: VN_DENTAL },
  { name: 'Google News VN', region: 'vn', kind: 'news', group: 'Khác', itemSource: true, noBody: true,
    feed: 'https://news.google.com/rss/search?q=' + encodeURIComponent('nha khoa OR "răng hàm mặt" OR "nha sĩ" when:7d') + '&hl=vi&gl=VN&ceid=VN:vi' },
];
export const SOURCES = process.env.NEWS_EXTRA !== '0' ? [...GUIDE_SOURCES, ...EXTRA_SOURCES] : GUIDE_SOURCES;

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
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tag = (x, name) => { const m = x.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i')); return m ? m[1] : ''; };
const attr = (x, name, a) => { const m = x.match(new RegExp('<' + name + '\\b[^>]*\\b' + a + '=["\']([^"\']+)["\']', 'i')); return m ? decode(m[1]) : ''; };
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const fname = id => id.replace(/[^a-z0-9_-]/gi, '_');
const abs = (u, base) => { try { return new URL(decode(u).trim(), base).toString(); } catch { return ''; } };

function cleanUrl(u) {
  try { const x = new URL(u.trim()); [...x.searchParams.keys()].forEach(k => /^(utm_|fbclid|gclid|mc_|ref$)/i.test(k) && x.searchParams.delete(k)); x.hash = ''; return x.toString(); }
  catch { return ''; }
}

async function get(url, accept = '*/*') {
  let err;
  for (let k = 0; k < 3; k++) {
    try { return await get1(url, accept); }
    catch (e) { err = e; if (/HTTP (401|403|404|410)/.test(e.message)) break; await new Promise(r => setTimeout(r, 1500 * (k + 1))); }
  }
  throw err;
}
async function get1(url, accept = '*/*') {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 40000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'vi,en;q=0.8' }, signal: ctl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    let cs = ((r.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || [])[1] || (buf.subarray(0, 2048).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
    try { return new TextDecoder(cs).decode(buf); } catch { return buf.toString('utf8'); }
  } finally { clearTimeout(t); }
}
async function pool(items, n, fn) { const q = items.slice(); await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) { const it = q.shift(); try { await fn(it); } catch (e) { if (process.env.NEWS_DEBUG) console.log('  ! ' + (e.message || e)); } } })); }

/* ---------- lam sach HTML (khong dung thu vien; chi giu whitelist) ---------- */
const OK_TAGS = new Set(['p', 'br', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'strong', 'b', 'em', 'i', 'u', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'sup', 'sub']);
const VOID = new Set(['br', 'img']);
const BAD_IMG = /logo|icon|avatar|pixel|spacer|blank|1x1|sprite|emoji|badge|share|button|loading|placeholder/i;
export function sanitize(html, base) {
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|svg|iframe|object|embed|form|button|select|textarea|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  const out = []; const stack = []; const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|</g; let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) { out.push(m[4]); continue; }
    if (m[2] === undefined) { out.push('&lt;'); continue; }
    let t = m[2].toLowerCase(); if (t === 'h1') t = 'h2'; if (t === 'h5' || t === 'h6') t = 'h4';
    if (!OK_TAGS.has(t)) continue;
    if (m[1]) { const i = stack.lastIndexOf(t); if (i >= 0) { while (stack.length > i) out.push('</' + stack.pop() + '>'); } continue; }
    if (t === 'a') {
      const h = abs(attr('<a ' + m[3] + '>', 'a', 'href'), base);
      if (!/^https?:/i.test(h)) { continue; }
      out.push('<a href="' + esc(h) + '" target="_blank" rel="noopener noreferrer">'); stack.push('a'); continue;
    }
    if (t === 'img') {
      const raw = '<img ' + m[3] + '>';
      let src = attr(raw, 'img', 'data-src') || attr(raw, 'img', 'data-lazy-src') || attr(raw, 'img', 'data-original') || attr(raw, 'img', 'src');
      if (!src) { const ss = attr(raw, 'img', 'srcset') || attr(raw, 'img', 'data-srcset'); if (ss) src = ss.split(',').pop().trim().split(/\s+/)[0]; }
      src = abs(src, base); if (!/^https?:/i.test(src) || BAD_IMG.test(src)) continue;
      out.push('<img src="' + esc(src) + '" alt="' + esc(attr(raw, 'img', 'alt')) + '" loading="lazy">'); continue;
    }
    out.push('<' + t + '>'); if (!VOID.has(t)) stack.push(t);
  }
  while (stack.length) out.push('</' + stack.pop() + '>');
  return out.join('').replace(/<(p|li|h[2-4]|a|strong|b|em|i|blockquote)>\s*<\/\1>/g, '').replace(/\s{3,}/g, ' ').trim();
}

const MON = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
function textDate(s) {
  let m = s.match(/(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(20\d{2})/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return Date.UTC(+m[3], +m[2] - 1, +m[1], 12);
  m = s.match(/ng[àa]y\s+(\d{1,2})\s+th[áa]ng\s+(\d{1,2})\s+n[ăa]m\s+(20\d{2})/i);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], 12);
  m = s.match(new RegExp('\\b(\\d{1,2})\\s+(' + MON + ')[a-z]*\\.?,?\\s+(20\\d{2})', 'i'));
  if (m) return Date.parse(m[1] + ' ' + m[2] + ' ' + m[3] + ' 12:00 UTC');
  m = s.match(new RegExp('\\b(' + MON + ')[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(20\\d{2})', 'i'));
  if (m) return Date.parse(m[1] + ' ' + m[2] + ' ' + m[3] + ' 12:00 UTC');
  return NaN;
}

/* ---------- trich noi dung bai bao tu HTML trang (heuristic, khong can thu vien) ---------- */
export function extractArticle(page, base) {
  let h = page.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|svg|iframe|nav|footer|aside)\b[\s\S]*?<\/\1\s*>/gi, '');
  const metaOf = (re) => { const m = page.match(re); return m ? decode(m[1]).trim() : ''; };
  const og = n => metaOf(new RegExp('<meta[^>]+(?:property|name)=["\']' + n + '["\'][^>]*content=["\']([^"\']*)["\']', 'i')) || metaOf(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + n + '["\']', 'i'));
  const title = og('og:title') || strip(tag(page, 'title'));
  const image = abs(og('og:image') || og('twitter:image'), base);
  const desc = og('og:description') || og('description');
  const dateStr = og('article:published_time') || og('og:published_time') || og('datePublished') || (page.match(/"datePublished"\s*:\s*"([^"]+)"/) || [])[1] || attr(page.match(/<time\b[^>]*>/i)?.[0] || '', 'time', 'datetime');
  const metaTs = Date.parse(dateStr || ''); let ts = metaTs;
  const byline = og('author') || og('article:author');
  // vung uu tien: <article> lon nhat, neu khong thi <main>, neu khong thi toan trang
  let region = '';
  for (const t of ['article', 'main']) { const ms = [...h.matchAll(new RegExp('<' + t + '\\b[^>]*>([\\s\\S]*?)</' + t + '>', 'gi'))].map(x => x[1]); if (ms.length) { region = ms.sort((a, b) => b.length - a.length)[0]; if (strip(region).length > 400) break; } }
  if (strip(region).length < 400) region = h;
  // gom cac doan <p> gan nhau thanh cum, chon cum co nhieu chu nhat
  const ps = [...region.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)].map(x => ({ i: x.index, e: x.index + x[0].length, len: strip(x[0]).length }));
  let best = null, cur = null;
  for (const p of ps) {
    if (cur && p.i - cur.e < 1800) { cur.e = p.e; cur.len += p.len; } else { cur = { i: p.i, e: p.e, len: p.len }; if (!best) best = cur; }
    if (!best || cur.len > best.len) best = cur;
  }
  let raw = best && best.len >= 60 ? region.slice(best.i, best.e) : '';
  for (let k = 0; k < 6; k++) { const m = raw.match(/^\s*<p\b[^>]*>[\s\S]*?<\/p>/i); if (m && strip(m[0]).length < 50) raw = raw.slice(m[0].length); else break; }
  let body = raw ? sanitize(raw, base) : '';
  if (!body && desc) body = '<p>' + esc(desc) + '</p>';
  if (isNaN(ts)) ts = textDate(strip(region).slice(0, 4000));
  return { title, image, desc, metaDate: !isNaN(metaTs), ts: isNaN(ts) ? 0 : ts, byline, html: body, textLen: strip(body).length };
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
    const dRaw = strip(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date') || tag(b, 'prism:publicationDate'));
    const ts = Date.parse(dRaw);
    const rawBody = tag(b, 'content:encoded') || tag(b, 'description') || tag(b, 'summary') || tag(b, 'content');
    const summary = strip(rawBody).replace(/\s*(The post|Read more|Continue reading).*$/i, '');
    let image = attr(b, 'media:content', 'url') || attr(b, 'media:thumbnail', 'url');
    if (!image) { const e = b.match(/<enclosure\b[^>]*>/i); if (e && /image/i.test(e[0])) image = attr(e[0], 'enclosure', 'url'); }
    if (!image) { const m = decode(unCdata(rawBody)).match(/<img[^>]+src=["']([^"']+)["']/i); if (m) image = m[1]; }
    if (!title || !link || !ts) continue;
    out.push({
      id: 'n' + sha(link), type: opt.kind === 'journal' ? 'research' : 'news', region: opt.region || 'intl', group: opt.group || '', title: trunc(title, 220), url: link, source: srcName,
      date: new Date(ts).toISOString(), summary: trunc(summary, 420), image: /^https?:/i.test(image) ? image : '',
      _html: decode(unCdata(tag(b, 'content:encoded'))), _full: summary,
    });
  }
  return out;
}

/* ---------- tim RSS tu trang chu / quet link bai viet ---------- */
export function discoverFeed(html, base) {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (const l of links) {
    if (!/rel=["']alternate["']/i.test(l) || !/type=["']application\/(rss|atom)\+xml["']/i.test(l)) continue;
    const href = abs(attr(l, 'link', 'href'), base);
    if (href && !/comment/i.test(href)) return href;
  }
  return '';
}
const NAV_BAD = /\/(tag|tags|category|danh-muc|chuyen-muc|page|trang|author|login|dang-nhap|lien-he|contact|gioi-thieu|about|search|tim-kiem|feed|wp-admin|wp-content|cart|privacy|terms|sitemap)(\/|$|\?)|\.(jpg|jpeg|png|gif|pdf|zip|docx?|xlsx?|css|js)(\?|$)/i;
// link bai viet that thuong co slug dai / nam-thang / ma so; link menu ("news-and-events", "/about"...) thi khong
const articleLike = u => { const segs = u.pathname.split('/').filter(Boolean), last = segs[segs.length - 1] || '', hy = (last.match(/-/g) || []).length;
  return /\/(19|20)\d{2}\/\d{1,2}(\/|$)/.test(u.pathname) || /\d{5,}/.test(u.pathname) || hy >= 4 || (segs.length >= 3 && hy >= 2); };
export function extractAnchors(html, base, max = SCRAPE_PER_SITE) {
  let host; try { host = new URL(base).hostname.replace(/^www\./, ''); } catch { return []; }
  const basePath = new URL(base).pathname;
  const seen = new Set(), good = [], rest = [];
  const body = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const tagA = '<a ' + m[1] + '>';
    const href = cleanUrl(abs(attr(tagA, 'a', 'href'), base));
    let text = strip(m[2]); if (!text) text = decode(attr(tagA, 'a', 'title') || '');
    if (!href || seen.has(href) || text.length < 12) continue;
    let u; try { u = new URL(href); } catch { continue; }
    const h = u.hostname.replace(/^www\./, '');
    if (!(h === host || h.endsWith('.' + host) || host.endsWith('.' + h))) continue;
    if (NAV_BAD.test(u.pathname + u.search) || u.pathname.length < 4 || u.pathname === basePath) continue;
    seen.add(href); (articleLike(u) ? good : rest).push({ title: trunc(text, 220), url: href });
  }
  return [...good, ...rest].slice(0, max);
}

/* ---------- PubMed ---------- */
export function parsePubmed(xml) {
  const arts = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
  const out = [];
  for (const a of arts) {
    const pmid = (a.match(/<PMID[^>]*>(\d+)<\/PMID>/) || [])[1];
    const title = strip(tag(a, 'ArticleTitle'));
    if (!pmid || !title) continue;
    const absParts = (a.match(/<AbstractText\b[^>]*>[\s\S]*?<\/AbstractText>/g) || []).map(t => {
      const lab = (t.match(/Label=["']([^"']+)["']/) || [])[1];
      return { label: lab && lab.toUpperCase() !== 'UNLABELLED' ? lab.charAt(0) + lab.slice(1).toLowerCase() : '', text: strip(t) };
    });
    const abstract = absParts.map(x => (x.label ? x.label + ': ' : '') + x.text).join(' ');
    const journal = strip((a.match(/<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/) || [])[1] || '');
    const pd = a.match(/<PubMedPubDate PubStatus="pubmed">[\s\S]*?<Year>(\d+)<\/Year>[\s\S]*?<Month>(\d+)<\/Month>[\s\S]*?<Day>(\d+)<\/Day>/);
    const date = pd ? new Date(Date.UTC(+pd[1], +pd[2] - 1, +pd[3], 12)).toISOString() : new Date().toISOString();
    const authors = (a.match(/<Author\b[^>]*>[\s\S]*?<\/Author>/g) || []).map(x => { const l = tag(x, 'LastName'), i = tag(x, 'Initials'); return l ? strip(l) + (i ? ' ' + strip(i) : '') : ''; }).filter(Boolean);
    const doi = (a.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/) || [])[1] || '';
    out.push({
      id: 'pmid:' + pmid, type: 'research', region: 'intl', group: 'Cơ sở dữ liệu', title: trunc(title, 260), url: 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/',
      source: 'PubMed' + (journal ? ' · ' + journal : ''), date,
      authors: authors.length > 3 ? authors.slice(0, 3).join(', ') + ', et al.' : authors.join(', '),
      doi, summary: trunc(abstract, 700), image: '',
      _abs: absParts,
    });
  }
  return out;
}

async function fetchPubmed(log) {
  const key = process.env.NCBI_API_KEY ? '&api_key=' + process.env.NCBI_API_KEY : '';
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
  const s = await get(base + 'esearch.fcgi?db=pubmed&retmode=json&retmax=300&sort=pub_date&datetype=edat&reldate=45&tool=rhm-news&term=' + encodeURIComponent(PUBMED_TERM) + key);
  const ids = JSON.parse(s).esearchresult?.idlist || [];
  if (!ids.length) return [];
  const items = [];
  for (let k = 0; k < ids.length; k += 100) items.push(...parsePubmed(await get(base + 'efetch.fcgi?db=pubmed&retmode=xml&tool=rhm-news&id=' + ids.slice(k, k + 100).join(',') + key)));
  log(`PubMed: ${ids.length} id, ${items.length} bai`);
  return items;
}

/* ---------- chon tin ---------- */
export function pickNews(cands, n, prio) {       // xen ke giua cac nguon cho da dang; prio: Map nguon -> so bai da luu (it bai hon thi duoc xet truoc)
  const by = new Map();
  cands.sort((a, b) => b.date.localeCompare(a.date)).forEach(i => { if (!by.has(i.source)) by.set(i.source, []); by.get(i.source).push(i); });
  const out = []; const lists = [...by.values()];
  if (prio) lists.sort((a, b) => (prio.get(a[0].source) || 0) - (prio.get(b[0].source) || 0));
  while (out.length < n && lists.some(l => l.length)) for (const l of lists) { if (l.length && out.length < n) out.push(l.shift()); }
  return out;
}

/* ---------- thu thap tu 1 nguon ---------- */
async function collect(s, log) {
  let feed = s.feed, siteHtml = '';
  let xml = '';
  if (feed) { try { xml = await get(feed, 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*'); } catch (e) { if (!s.site) throw e; log(`     ${s.name}: feed loi (${e.message}), thu tu dong tim...`); feed = ''; } }
  if (!xml && s.site) {
    siteHtml = await get(s.site, 'text/html,*/*');
    feed = discoverFeed(siteHtml, s.site);
    if (feed) { try { xml = await get(feed); } catch { xml = ''; } }
  }
  let items = xml ? parseFeed(xml, s.name, s) : [];
  let via = xml ? 'rss' : '';
  if (!items.length && s.site) {   // khong co RSS dung duoc -> quet link tren trang
    if (!siteHtml) siteHtml = await get(s.site, 'text/html,*/*');
    items = extractAnchors(siteHtml, s.site).map(a => ({
      id: 'n' + sha(a.url), type: s.kind === 'journal' ? 'research' : 'news', region: s.region, group: s.group || '', title: trunc(a.title, 220), url: a.url, source: s.name,
      date: new Date().toISOString(), summary: '', image: '', _scraped: true,
    }));
    via = 'quet-link';
  }
  return { items, via };
}

/* ---------- bai quet link: mo trang kiem tra that, khong dung thi bo ---------- */
async function enrichScraped(items, s, isKnown, minTs) {
  const todo = items.filter(i => i._scraped && !isKnown(i)).slice(0, SCRAPE_PER_SITE);
  const ok = [];
  await pool(todo, 3, async it => {
    const page = extractArticle(await get(it.url, 'text/html,*/*'), it.url);
    if (!page.metaDate && !articleLike(new URL(it.url))) return;                    // ngay chi doan tu text / khong co ngay: chi nhan link giong bai viet
    if (!page.ts) page.ts = Date.now();
    if (page.ts < minTs) return;
    const title = trunc((page.title || '').replace(/\s*[|–-]\s*[^|–-]{3,40}$/, ''), 220);
    if (title.length < 8 || page.textLen < 100) return;                            // khong phai bai viet
    if (s.filter && !s.filter.test((title + ' ' + (page.desc || '') + ' ' + strip(page.html).slice(0, 4000)).normalize('NFC'))) return;
    it.title = title; it.date = new Date(page.ts).toISOString();
    it.summary = trunc(page.desc || strip(page.html), 420);
    if (page.image) it.image = page.image;
    it._art = page; ok.push(it);
  });
  return ok;
}

/* ---------- lay noi dung bai de doc trong app ---------- */
async function buildArticle(it, s) {
  const base = { id: it.id, url: it.url, title: it.title, source: it.source, date: it.date };
  if (it._abs) {                                     // PubMed: abstract co cau truc
    const html = it._abs.map(p => '<p>' + (p.label ? '<strong>' + esc(p.label) + ':</strong> ' : '') + esc(p.text) + '</p>').join('');
    return { ...base, byline: it.authors || '', image: '', html, kind: 'abstract' };
  }
  if (it.type === 'research' && !it._scraped) {      // tap chi: RSS thuong chi co abstract
    const h = it._html ? sanitize(it._html, it.url) : '';
    return { ...base, byline: '', image: it.image || '', html: h || (it._full ? '<p>' + esc(it._full) + '</p>' : ''), kind: 'abstract' };
  }
  if (!FULLTEXT || s?.noBody) return null;
  let html = it._html ? sanitize(it._html, it.url) : '';
  let page = null;
  if (it._art) { page = it._art; if (page.textLen > strip(html).length) html = page.html; }
  else if (strip(html).length < 600 || it._scraped) {
    try { page = extractArticle(await get(it.url, 'text/html,*/*'), it.url); } catch { page = null; }
    if (page && page.textLen > strip(html).length) html = page.html;
  }
  if (page) {
    if (it._scraped) {
      if (page.ts) it.date = new Date(page.ts).toISOString();
      if (page.title && page.title.length >= 15) it.title = trunc(page.title.replace(/\s*[|–-]\s*[^|–-]{3,40}$/, ''), 220);
      if (page.desc && !it.summary) it.summary = trunc(page.desc, 420);
    }
    if (!it.image && page.image) it.image = page.image;
  }
  if (strip(html).length < 150) return null;
  return { ...base, title: it.title, date: it.date, byline: page?.byline || '', image: it.image || '', html, kind: 'full' };
}

async function main() {
  const log = m => console.log(m);
  let db = { updated: 0, items: [] };
  try { db = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
  const have = new Set(db.items.map(i => i.id)); const haveUrl = new Set(db.items.map(i => i.url));
  const normT = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
  const haveTitle = new Set(db.items.map(i => normT(i.title)));
  const minTsFor = s => Date.now() - (s.region === 'vn' ? VN_AGE_DAYS : MAX_AGE_DAYS) * 864e5;
  let okCount = 0; const bySrc = new Map(SOURCES.map(s => [s.name, s]));
  const pools = { news: [], research: [], vn: [] };

  await pool(SOURCES, 6, async s => {
    try {
      let { items, via } = await collect(s, log);
      const scraped = items.length > 0 && items.every(i => i._scraped);
      if (scraped) items = await enrichScraped(items, s, i => have.has(i.id) || haveUrl.has(i.url), minTsFor(s));
      else if (s.filter) items = items.filter(i => s.filter.test((i.title + ' ' + i.summary).normalize('NFC')));
      const fresh = items.filter(i => !have.has(i.id) && !haveUrl.has(i.url) && !haveTitle.has(normT(i.title)) && Date.parse(i.date) >= minTsFor(s));
      log(`OK   [${s.region}] ${s.name} (${via || 'khong co bai'}): ${items.length} bai${s.filter ? ' sau loc' : ''}, ${fresh.length} moi`);
      (s.region === 'vn' ? pools.vn : (fresh.length && fresh[0].type === 'research' ? pools.research : pools.news)).push(...fresh.map(i => ({ ...i, _s: s.name })));
      okCount++;
    } catch (e) { log(`LOI  [${s.region}] ${s.name}: ${e.message}`); }
  });
  let pub = [];
  try { pub = (await fetchPubmed(log)).filter(i => !have.has(i.id)); okCount++; } catch (e) { log(`LOI  PubMed: ${e.message}`); }
  pools.research.push(...pub);

  const dedupe = arr => { const seen = new Set(), st = new Set(); return arr.filter(i => { const k = normT(i.title); if (seen.has(i.url) || (k && st.has(k))) return false; seen.add(i.url); st.add(k); return true; }); };
  pools.news = dedupe(pools.news); pools.research = dedupe(pools.research); pools.vn = dedupe(pools.vn);
  let pickedN = pickNews(pools.news.slice(), NEWS_N), pickedR = pickNews(pools.research.slice(), RESEARCH_N);
  let short = PER_RUN - pickedN.length - pickedR.length;       // thieu o ben nao thi lay bu tu ben kia
  if (short > 0) {
    const restR = pickNews(pools.research.filter(i => !pickedR.includes(i)), short); pickedR = pickedR.concat(restR); short -= restR.length;
    if (short > 0) pickedN = pickedN.concat(pickNews(pools.news.filter(i => !pickedN.includes(i)), short));
  }
  const cnt = new Map(); db.items.forEach(i => cnt.set(i.source, (cnt.get(i.source) || 0) + 1));
  const pickedV = pickNews(pools.vn.slice(), VN_N, cnt);
  const picked = [...pickedN, ...pickedR, ...pickedV];
  log(`Chon ${picked.length} tin moi (${pickedN.length} tin, ${pickedR.length} nghien cuu, ${pickedV.length} trong nuoc)`);
  if (!okCount) { console.error('Tat ca nguon deu loi'); process.exit(1); }

  // lay noi dung bai (che do doc trong app)
  fs.mkdirSync(ART_DIR, { recursive: true });
  await pool(picked, 4, async it => {
    const art = await buildArticle(it, bySrc.get(it._s));
    if (art) { fs.writeFileSync(path.join(ART_DIR, fname(it.id) + '.json'), JSON.stringify(art)); it.body = 1; }
  });
  log(`Co noi dung doc trong app: ${picked.filter(i => i.body).length}/${picked.length}`);

  const now = Date.now();
  const clean = picked.map(i => { const o = { ...i }; delete o._html; delete o._full; delete o._abs; delete o._s; delete o._scraped; delete o._art; o.crawled = now; return o; });
  if (!clean.length) { log('Khong co tin moi, khong ghi file.'); return; }
  db.items = [...clean, ...db.items].sort((a, b) => b.date.localeCompare(a.date)).slice(0, KEEP);
  db.updated = now;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(db, null, 1) + '\n');

  // don dep: chi giu noi dung bai cua ART_KEEP tin moi nhat
  const keep = new Set(db.items.filter(i => i.body).slice(0, ART_KEEP).map(i => fname(i.id) + '.json'));
  for (const f of fs.readdirSync(ART_DIR)) if (!keep.has(f)) fs.unlinkSync(path.join(ART_DIR, f));
  db.items.forEach(i => { if (i.body && !keep.has(fname(i.id) + '.json')) delete i.body; });
  fs.writeFileSync(OUT, JSON.stringify(db, null, 1) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
