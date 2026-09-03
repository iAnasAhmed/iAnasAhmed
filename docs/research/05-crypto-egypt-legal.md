# Crypto & Binance in Egypt — legal position

**Last verified:** 2026-09-02
**Status: ⛔ BLOCKING ISSUE for the Binance milestone. Read before Phase 3.**

## The law

**Article 206 of Law No. 194 of 2020** (the Central Bank and Banking System Law)
prohibits **issuing, trading, promoting, or operating any platform dealing in
crypto assets** without prior approval from the Central Bank of Egypt.

**No such approval has been publicly granted for retail crypto trading.**
The default legal status is therefore **prohibited**.

## Penalties

Reported penalties for violations include **imprisonment** and fines of
**EGP 1,000,000 to EGP 10,000,000**.

For context: the stated starting capital for this project is EGP 30,000. The
**minimum** fine is over 33× the entire portfolio.

## The reality gap

Egypt is nonetheless one of the fastest-growing crypto markets (reported ~42.8%
growth in activity), driven by devaluation and capital controls. International
exchanges continue to serve Egyptian users. **Widespread practice does not
change the legal text**, and enforcement risk is borne entirely by the individual.

## What this means for this project

This is stated once, plainly, and then the project moves on:

- **The risk is legal, not technical.** No amount of good software mitigates it.
- **Before any Phase 3 work**, the owner should get advice from an Egyptian
  lawyer on current enforcement and personal exposure. Regulation may also change
  — Egypt has been reviewing fintech rules actively.
- **Tracking is not trading.** A read-only portfolio tracker that records
  balances is a different act from executing trades. Phase 3 is therefore scoped
  as **read-only tracking first**, and the architecture is exchange-agnostic.
- **Phase 3 remains gated behind Phase 1 completion regardless** — that is the
  owner's own instruction in `CLAUDE.md`.

## A note on "make real money"

The mandate mentions trying to make real money on Binance. Two facts belong on
the record, without moralising:

1. The legal exposure above is real and asymmetric against a 30,000 EGP account.
2. EGP T-bills currently pay ~25% risk-free (`03-macro-context.md`). Leveraged or
   high-frequency crypto trading is not a higher-expected-return version of that;
   for the large majority of retail participants it is a **negative**-expected-value
   activity after fees, spreads, and funding costs. The high local risk-free rate
   makes the opportunity cost unusually steep.

This is context, not a veto. The decision is the owner's.

## Sources

- [Andersen Egypt — The legality of cryptocurrency in Egypt](https://eg.andersen.com/legality-cryptocurrency-in-egypt/)
- [Youssry Saleh Law Firm — Cryptocurrency legality in Egypt](https://youssrysaleh.com/en/cryptocurrency-legality-in-egypt/)
- [Lexology — Cryptocurrency legality in Egypt](https://www.lexology.com/library/detail.aspx?g=a21a3371-3157-4c46-8ab2-1e15e9a59450)
- [Central Bank of Egypt crypto ban: Law No. 194/2020 explained](https://ftfa-sao.org/central-bank-of-egypt-crypto-ban-law-no.-194-2020-explained)
