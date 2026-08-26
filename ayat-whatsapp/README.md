# WhatsApp abandoned-cart recovery (the RicRac setup, rebuilt for Ayat Fahiem)

What the screenshots actually show: a **Meta Cloud API** marketing template —
IMAGE header, Arabic body, `Type STOP to unsubscribe` footer, one URL button
(`View Cart` / `إتمام الطلب`) pointing at a tracked link — sent by **Zoko** as the
BSP (`web3.api.zoko.io` is Zoko's click-tracking domain). "This business uses a
secure service from Meta to manage this chat" is the standard Cloud API banner,
not something they configured.

Store: `ayatfahiem.com` (`6x4bcd-rk.myshopify.com`), Shopify Basic, EGP, COD via Bosta.

## Steps

1. **Meta Business verification** — business.facebook.com → Business settings →
   Security Centre → Verify. Commercial register + utility bill. 1–3 days. Nothing
   below can go live until this passes.
2. **Phone number** — a number that is *not* currently registered on the WhatsApp
   or WhatsApp Business app. Delete the account on it first if it is.
3. **Pick the BSP.** Zoko $49.99/mo is what RicRac pays. Cheaper equivalents with the
   same Shopify cart-recovery flow: FavCRM ~$19.99/mo, Sendwo, Wati, Interakt.
   All of them resell the same Cloud API; Meta's per-message rate is on top.
4. **Connect Shopify** — install the BSP's Shopify app → embedded signup (Meta login,
   pick WABA, pick number, OTP). It auto-subscribes to `checkouts/create`.
5. **Upload the header image** to the BSP media library and get its media handle.
   1200×628, under 5 MB. Same layout as the RicRac creative: product on white +
   annotated benefits + logo + domain strip.
6. **Submit 2 marketing templates** (Arabic, `ar`) — see `templates/` in this folder.
   Approval is usually under 24 h. Category MUST be MARKETING; a cart reminder
   submitted as UTILITY gets rejected or reclassified.
7. **Build the flow** — trigger `checkout abandoned`, condition `order not placed`:
   - T+1 h → `abandoned_cart_1_ar` (no discount, reassurance — the RicRac copy)
   - T+24 h → `abandoned_cart_2_ar` (5–10% code, expiring)
   - stop the sequence on order created or on `STOP`
8. **Opt-in.** Marketing templates need consent. Collect it in three places:
   the BSP's checkout-page opt-in block, the WhatsApp chat widget, and a
   "استلام العروض على واتساب" checkbox in the account/newsletter form. Log the
   timestamp and source — Meta asks for it in quality reviews.
9. **Attribution** — put `?utm_source=whatsapp&utm_medium=crm&utm_campaign=abandoned_cart_1`
   on the button URL. Zoko-style tracked links break Shopify's native attribution
   otherwise.
10. **Warm up.** New numbers start at a 250 unique-recipient/24 h tier. Send to your
    warmest segment first; tier doubles as quality stays green.

## Costs (Meta rates, Egypt, per delivered message)

| Category | Rate |
|---|---|
| Marketing | $0.1073 |
| Utility | $0.0073 |
| Authentication | $0.0130 |

BSP markup sits on top of this. At ~1,000 abandoned carts/month you are looking at
roughly $107 of Meta spend plus the platform fee — the whole thing pays for itself
at a 3–5% recovery rate on a 1,000+ EGP AOV.

Cheap win while you are here: order-status messages (`تم الشحن`, `الشحنة في الطريق`)
are UTILITY at $0.0073 — 14× cheaper than marketing, and on a COD store they cut
refused deliveries. Wire Bosta's status webhook into the same BSP.

## Rules that get accounts limited

- Marketing templates outside the 24 h window always cost money, always need opt-in.
- Keep `Type STOP to unsubscribe` in the footer and honour it within seconds.
- Quality rating drops → template paused → whole number throttled. Watch it weekly
  in WhatsApp Manager.
- One reminder at T+1 h and one at T+24 h. A third send is where block rates spike.
