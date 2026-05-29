# Ann's Bibliotheca

**Live URL:** https://dimaseinc.org/ann-reads
**Listed on:** https://dimaseinc.org/applications
**Access:** Public — no login required, opens straight to library (2026-03-27)

## Login (Optional)
- No login required — app opens directly to full library
- Register button on login screen creates a DiMase Inc. account via `/auth/register`
- Local bypass still works: Username `Ann` or `gieseann44@gmail.com` / Password `7878`
- Any registered DiMase Inc. account can also access

## Features
- **70,000+ free books** — Project Gutenberg via `/ann/books` + `/ann/read/:id` proxy (CF edge cached)
- Full in-app reader — no external site for Gutenberg books
- 18-genre filter pills + full-text search
- Font size controls (A- / A+)
- **ACPL Digital Library section** — Allen County Public Library OverDrive integration
  - Sign in once with ACPL library card → access tens of thousands of modern ebooks
  - 16 genre tiles + Ann's quick searches (alpha shifter, mafia, vampire, fae, etc.)
  - Search bar routes to ACPL OverDrive catalog
  - Links: Most Popular, New Releases, Available Now, Staff Picks, All Subjects, Audiobooks, Magazines

## Featured Novels (Hero + Grid)
All verified direct links — fully free, no paywall:

| Title | Platform | URL |
|-------|----------|-----|
| **Rejected by the Alpha** (HERO) | Wattpad | https://www.wattpad.com/story/17539298 |
| Claimed by the Alpha Heirs | Royal Road | https://www.royalroad.com/fiction/158311/claimed-by-the-alpha-heirs/chapter/3173541/confusion |
| The Lycan King's Mate | Wattpad | https://www.wattpad.com/story/270236143 |
| Rejected by the Alpha | Wattpad | https://www.wattpad.com/story/17539298 |
| The Mafia King's Obsession | Wattpad | https://www.wattpad.com/story/217705658 |
| The Billionaire's Secret Wife | Wattpad | https://www.wattpad.com/story/186635532 |
| Forced Bride of the Vampire Lord | WebNovel | https://m.webnovel.com/book/forced-bride-of-the-vampire-lord_22244643905115305 |
| Midnight Prince | Royal Road | https://www.royalroad.com/fiction/155230/the-midnight-prince/chapter/3105171/chapter-1 |
| CEO's Contract Marriage | Wattpad | https://www.wattpad.com/story/284554326 |

> Note: "The Alpha's Contract" (GoodNovel) removed — paywalled after a few chapters, requires app download.

## Server Routes (Cloudflare Worker)
- `GET /ann/books?page=N&topic=X&search=Y` — proxies Gutendex, CF cached 1hr
- `GET /ann/book/:id` — book metadata from Gutendex, cached 24hr
- `GET /ann/read/:id` — full book text from Project Gutenberg, cached 24hr
- `/ann-reads` and `/ann` in `publicPrefixes` — no site session auth required

## ACPL OverDrive Integration
- Library: Allen County Public Library (Fort Wayne, IN)
- Catalog: https://acpl.overdrive.com
- Auth: User signs in once with ACPL library card number + PIN
- All links open in OverDrive's web reader — no app required
- Search route: `https://acpl.overdrive.com/search?query={q}&formats=ebook`
- Genre routes: `https://acpl.overdrive.com/subjects/{Genre}?formats=ebook`

## File Location
- Server: `/media/Storage/website/dimaseinc-website/ann-reads.html`
- Deploy: `ssh buyvm "cd /media/Storage/website/dimaseinc-website && npx wrangler deploy"`

## Ecosystem Monitoring
- Watched by dimase-monitor: `https://dimaseinc.org/ann-reads` in HTTP_ENDPOINTS
- Watched by DiMase Control ecosystem panel: `ann-bibliotheca` in SERVICES dict
- Watched by Telegram bot SERVICES dict

## Future Features
- Reading progress saved to D1 database
- Bookmarks and personal reading history
- Wattpad OAuth for dynamic story browsing
- Download book as text file
