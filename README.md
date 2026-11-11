# Beam Book

Booking with negotiation for any business, from one app: a request form with the business's own questions, offers and counter-offers on price, date and time, scope and terms, scheduling with confirmation, outside-calendar sync, an inbox with logins and roles, texts and emails, and an Instagram strip. Each business gets its own booking page, inbox, logins, team, settings, colors and logo. It can live on Beam Book's own address or inside the business's existing website. "Powered by: Beam Book" (Neal Media & Production).

It's a separate product from the Black Wolf Tattoo Club site. Black Wolf keeps its own site and engine, and could become a Beam Book customer later.

## Business types (starting points, all editable)
| Type | Asks about | Clients can counter | Clients name the first offer |
|---|---|---|---|
| Performer / DJ / band | Event type, venue, guests, sound | Price, date and time, scope, terms | Yes |
| Trades and services | Address, photos, time of day, access | Price, date and time, scope | No |
| Photo / video / design | Project type, location, deliverables, references | Price, date and time, scope, terms | Yes |
| Tattoo shop | Placement, size, style, photos, cover-up | No (accept or decline) | No |
| Any other business | Nothing extra | Price, date and time | No |

The control page (Neal) and the business's own inbox (**Booking form**, for the Owner and Site admins) can change all of it: the words ("Book a gig", "performer", "set"), the questions (short or long answer, number, date, time, pick one, pick several, tick box, address, amount, photos), the age and deposit tick boxes, the lengths offered, and which terms clients may counter.

## Barbershop mode (instant booking and the client list)
- **Business type "Barbershop / salon"** turns on instant booking: clients pick a service (fixed price and length), a barber or "First available", and an open time, and they're booked at once. No request or approval. Any shop can switch it on or off under **Booking form → Instant booking**, where the services are edited. `/booking` sends clients to `/appointment` while it's on.
- **Clients** (inbox): every shop's own list. Search by name, phone (or last 4 digits) or email; profile with preferred barber, notes and visits; add, edit, delete. Online bookings add or update the client automatically (matched by phone or email).
- **Import** (Owner / Site admin): a CSV from Squire or anything else. The file is read in the browser; only name, phone, email, barber, last visit, last service and notes are uploaded. Payment method, tips and every other column never leave the owner's computer, and the server ignores them if sent. Duplicates merge; running it again is safe. **Remove every client** undoes an import.
- **Texts need consent.** Imported clients get email reminders only, unless the owner confirms they opted in to texts. Online bookers tick a box. Nothing sends marketing.
- **Reminders:** a daily job (`/reminders/daily`, about 10 am Alaska time) emails, and texts if allowed, everyone booked for tomorrow, once per appointment. Set `CRON_SECRET` in Vercel so only Vercel can run it.
- **Inbox** loads the newest 300 requests in one go, with **Load older requests** for the rest.
- Payments are not handled: the shop keeps its card reader for checkout.

## Offers
- Either side can send an offer: price, date, start time, length, what's included, terms and deposit, plus a note. A new offer replaces the open one, which is marked "countered". The full history shows on both sides.
- Clients can counter only the terms the business allows. Anything else is copied from the business's last offer.
- **Accepting settles it.** With a date, time and length, it goes straight onto the calendar (checked against the business's calendar, with an "accept anyway" option for the business). With only a length, the client picks an open time. With neither, it's "Agreed", and the business sets the time.

## On an existing website
Each business's inbox (**Booking form → Put it on your website**) and the control page show copy-and-paste code:
- `<div data-beambook></div>` plus `<script src="https://<their address>/embed.js" async></script>` puts the form right on the page. It resizes itself and drops Beam Book's header and footer.
- Any link or button with `data-beambook-button` opens the form in a pop-up.
- `data-floating="Book now"` on the script tag adds a corner button on every page.
The booking pages allow framing (`frame-ancestors *`); the inbox and control page don't.

## How shops are kept apart
- **Web address decides the shop.** Each request is tied to one shop by its address: a shop's own address added on the control page (e.g. `book.theirshop.com`), or `<shortname>.<BEAMBOOK_DOMAIN>` when a wildcard domain is set up. An address with no shop shows "No booking page here".
- **Data:** every shop's records live under its short name (`blackwolf:…`) and its photos under `blackwolf/…`. Beam Book's own records live under `beambook:…`.
- **Logins** are per shop. The login cookie is signed with the shop's short name, so a login from one shop doesn't work at another. There is no shared shop password.
- Shop settings are cached for up to 15 seconds per server, so changes made on the control page can take that long to show.

## Pages (same for every shop; the shop's name, details, colors and logo fill in when the page loads)
| Address | What's there |
|---|---|
| `/` and `/booking` | Request form |
| `/artists` | The business's team, plus the Instagram strip once connected |
| `/embed.js` | The script businesses put on their own website |
| `/request` | Client's private status page (quote, accept, messages, photos) |
| `/schedule` | Approved clients pick an open time |
| `/admin` | The shop's inbox |
| `/platform` | **Beam Book control page** (Neal): add and manage shops |

## Control page (`/platform`)
- **Add a shop:** name, short name, city, phone, address, Instagram, time zone, the Owner's name and email, first artist, dark or light, accent color, optional gold corners. You get a one-time link (7 days) for the Owner to set their password, with buttons to email or text it.
- **Shop settings:** everything above, plus tagline, website, shop email (request alerts go here), minimum age, extra web addresses, logo, deposit wording, placements, style choices and starting hours.
- **New owner password link** if the Owner is locked out. **Turn off / back on** hides a shop without deleting anything.
- The Owner adds artists and front desk from their own inbox (Team).

## Setup (once)
1. New GitHub repo `beam-book` with these files, then a new Vercel project from it. **Use Vercel Pro**: Beam Book is a paid product, and Hobby is for non-commercial use only. It's 12 functions.
2. Vercel → Storage: connect **Upstash Redis** and **Blob (private)** to the project.
3. Environment variables: see `.env.example`. Minimum `PLATFORM_PASSWORD`, `SESSION_SECRET` and `BEAMBOOK_URL`.
4. Domains: add the main address (e.g. `book.nealmedia.app`). For automatic shop addresses, add a wildcard `*.book.nealmedia.app`; Vercel needs to run the DNS for wildcards. Otherwise add each shop's address one at a time (Vercel → Domains, and the same address in that shop's Web addresses).
5. Open `<BEAMBOOK_URL>/platform`, log in, and add a shop.

## Moving Black Wolf over (later)
Black Wolf's existing data uses the same layout (`blackwolf:…`). To move it, create the shop here with the short name `blackwolf` and copy its Redis keys and Blob files into Beam Book's storage, or connect the same Upstash and Blob stores. Then point the Book button and the site's links at the Beam Book address.

## Local
`npm install`, then `PLATFORM_PASSWORD=x SESSION_SECRET=y BEAMBOOK_DOMAIN=localhost npm run dev`. Open `http://localhost:3000/platform`, add a shop, then visit `http://<shortname>.localhost:3000`. `npm test` runs 44 end-to-end checks, including that two shops never see each other's data.
