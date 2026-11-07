# Age Assurance Vendors and Jurisdictions Requiring Real Age Verification (as of Nov 2026)

Scope note: Research done 2026-11-07 with a limited tool budget (about 16 searches/fetches). Most findings come from secondary sources (law-firm blogs, trade press, vendor blogs). Items marked **[unverified]** are background knowledge from before this session, not confirmed by a source fetched here. This is not legal advice. A lawyer must confirm threshold, definition and extraterritorial questions before launch.

## Q1. Age-assurance vendors: price, minimums, privacy, accuracy, web/PWA support

### Takeaway
Almost no vendor publishes per-check prices. Figures from aggregators range from about $0.10 to $1.50 per check and conflict with each other, so Aweborn needs direct quotes (and should ask about nonprofit pricing, which no source mentioned). k-ID's AgeKit is reportedly free at the entry level. Yoti and k-ID are the main facial-age-estimation options for web; Apple and Google OS age signals only work inside native or store-distributed apps, not a plain PWA.

### Cited Findings
**Yoti**
- No public per-check price for facial age estimation; rates are set in an Order Form or Pricing Schedule and sold through enterprise sales. — [fitgap listing](https://us.fitgap.com/products/006203/yoti-age-verification); [Gartner](https://www.gartner.com/reviews/product/yoti-age-verification); [Capterra](https://www.capterra.com/p/10004520/Yoti-Identity-Verification/)
- The often-quoted "$0.10 per check" comes from Didit, a competitor, in its own comparison blogs. Treat it as marketing, not a verified Yoti price. — [Didit vs Yoti](https://didit.me/blog/didit-vs-yoti-kyc/)
- Yoti publishes accuracy white papers (July 2025 edition) and its CEO's February 2026 post discusses independent testing (NIST) of facial age estimation. — [Yoti white paper Jul 2025](https://www.yoti.com/wp-content/uploads/2025/07/Yoti-Age-Estimation-White-Paper-July-2025-PUBLIC-v1.pdf); [Yoti CEO blog Feb 2026](https://www.yoti.com/blog/thoughts-from-our-ceo-february-2026/)
- Yoti reached EBITDA profitability and expects facial age estimation growth (2025). — [Biometric Update](https://www.biometricupdate.com/202504/yoti-reaches-ebitda-profitability-expects-further-facial-age-estimation-growth)
- Minecraft chose Yoti for age verification (Jan 2026). — [Biometric Update](https://www.biometricupdate.com/202601/age-verification-expands-in-gaming-minecraft-selects-yoti-discord-tests-persona)
- Yoti's old public pricing page (yoti.com/business/pricing) returned HTTP 404 when fetched on 2026-11-07, so public list pricing appears to have been removed.
- **[unverified]** Yoti states that the selfie is deleted right after the age estimate is returned and is not used for identification. Its white papers describe a mean absolute error of roughly 1-1.5 years for 13-24-year-olds. Check the current white paper for exact numbers.

**Persona**
- Volume-based pricing per verification type, with no published numbers. One aggregator reports an entry tier of about $250/month on a 12-month term. — [xpay.sh Persona pricing](https://www.xpay.sh/saas-pricing/persona/)
- Offers selfie age estimation, plus email-based age estimation through a VerifyMy integration. — [Persona help: age assurance](https://help.withpersona.com/articles/5I4utwPPHF4TilUvZTJCsh.md); [Persona help: VerifyMy integration](https://help.withpersona.com/articles/4jQlPiE68KcLjNTLox1tsc.md)
- Used by Reddit and Roblox. Discord dropped Persona in Feb 2026 because Discord now requires facial estimation to run entirely on-device and Persona "did not meet that bar." — [Biometric Update](https://www.biometricupdate.com/202602/discord-apologizes-for-persona-snafu-delays-global-age-verification-rollout); [idtechwire](https://idtechwire.com/discord-delays-global-age-verification-to-h2-2026-cuts-ties-with-persona/); [EFF](https://www.eff.org/deeplinks/2026/02/discord-voluntarily-pushes-mandatory-age-verification-despite-recent-data-breach)

**Veriff**
- One aggregator lists an Essential tier at $49/month + $0.80 per verification and a Plus tier at $1.39 per verification. Other sources say the pricing page shows no per-check numbers. — [xpay.sh Veriff](https://www.xpay.sh/agent-ready-index/veriff)
- Selfie age estimation is available without document verification. — same source
- A rental-platform plugin quotes $1.50 per check for both Veriff and Persona. This is likely integration pricing, not list price. — [Levy Fleets help](https://fleets.levyelectric.com/help/plugins/veriff-and-persona-kyc)

**k-ID**
- The AgeKit API is reported as free; the full platform is priced by quote. — [startupstash, Oct 2026](https://startupstash.com/best-age-assurance-verification-platforms/)
- Discord's main global vendor. It does facial age estimation and supports ID-document verification through Veratad. — [piunikaweb](https://piunikaweb.com/2026/02/12/discord-uk-age-verification-persona-vendor-shift/); [Biometric Update](https://www.biometricupdate.com/202602/discord-apologizes-for-persona-snafu-delays-global-age-verification-rollout)

**VerifyMy**
- Pricing by quote; no public per-check figure. Offers email-based age estimation (also sold through Persona). — [startupstash](https://startupstash.com/best-age-assurance-verification-platforms/); [Persona help](https://help.withpersona.com/articles/4jQlPiE68KcLjNTLox1tsc.md)

**Incode, Privately, AgeChecked, Stripe Identity**
- Incode publishes a European age-verification map e-book (vendor material). — [Incode](https://www.incode.com/e-books/age-verification-map-europe/reader.html)
- No 2026 pricing was found for Privately, AgeChecked or Incode. See Gaps.

**Apple and Google OS-level age signals**
- Apple's Declared Age Range API returns a user's age category and whether it was confirmed by credit card, government ID or another method. — [ppc.land](https://ppc.land/declared-age-range/); [9to5mac](https://9to5mac.com/2026/06/03/apple-says-texas-app-store-age-assurance-rules-start-tomorrow-after-court-ruling/)
- Google Play Age Signals returns ageLower/ageUpper bands (0-12, 13-15, 16-17, 18+). — [ppc.land](https://ppc.land/apple-activates-texas-sb-2420-age-rules-for-app-store-after-injunction-lifted/)
- Texas SB 2420 (app store age law): preliminarily enjoined 23 Dec 2025, so Apple paused. The Fifth Circuit then stayed the injunction and Texas requirements took effect 4 June 2026. The merits litigation is unresolved. — [9to5mac Dec 2025](https://9to5mac.com/2025/12/23/texas-judge-blocks-state-app-store-age-verification-law/); [MacRumors Jun 2026](https://www.macrumors.com/2026/06/03/apple-app-store-texas-sb-2420); [Biometric Update Jun 2026](https://www.biometricupdate.com/202606/app-store-age-verification-law-back-on-in-texas-but-more-challenges-coming)
- California Digital Age Assurance Act (AB 1043, signed 13 Oct 2025, effective 1 Jan 2027): OS providers collect age at account setup and expose an age-bracket signal; app developers must request it. Colorado SB 26-051 is a similar device-level law effective 1 Jul 2028. — [ageonce](https://www.ageonce.com/blog/us-state-age-verification-laws-2026); [closednetwork tracker](https://closednetwork.io/us-age-verification-laws-live-tracker/)
- **[unverified]** Utah (SB 142, 2025) and Louisiana also passed app-store accountability laws in 2025.

### Inferences
- For a PWA, OS age signals are mostly unavailable today. They become relevant if Aweborn ships a store-wrapped app (TWA or Capacitor), or for web once AB 1043-style signals reach browsers (the law's application to browsers is not confirmed).
- Budget planning: assume roughly $0.10-$1.50 per facial-estimation check until quotes arrive. Because checks are one-time and only in required jurisdictions, total cost is probably small. Ask Yoti and k-ID specifically about nonprofit pricing and monthly minimums.
- Pick a vendor that does on-device or immediate-deletion processing. That privacy point is now a public expectation, as the Discord-Persona backlash shows.

### Gaps
- No verified current per-check prices, minimums or nonprofit discounts for any vendor, Yoti included. Get direct quotes.
- No 2026 info found on Privately, AgeChecked, Incode or Stripe Identity pricing or capabilities. **[unverified]** Stripe Identity has historically listed about $1.50 per document+selfie check. It is ID-document verification, not age estimation.
- Couldn't confirm current Yoti accuracy numbers or retention wording from a primary page.

## Q2. US state laws requiring age verification for sites with sexual material

### Takeaway
About 27 states had adult-site age-verification laws as of Aug-Sep 2026. The constitutional question is settled for one-third-style laws (Free Speech Coalition v. Paxton, 27 June 2025, 6-3, intermediate scrutiny). Most laws trigger when more than one-third of a site's material is "harmful to minors," which is likely below Aweborn's expected share. But some states (Tennessee, Indiana, South Dakota, Missouri reportedly) apply more broadly, and how "site" and "material" are measured is unclear for a UGC platform. Drawn or animated depictions are expressly covered in at least Utah's definition.

### Cited Findings
- Count: 27 states per Sep 2026 and Aug 13, 2026 guides citing the Free Speech Coalition tracker. A June 2026 guide said 25, with West Virginia becoming the 26th on 12 June 2026; Iowa and Missouri were later additions. — [ageonce](https://www.ageonce.com/blog/us-state-age-verification-laws-2026); [recordinglaw](https://www.recordinglaw.com/us-laws/age-verification-laws/); [automatehorizon](https://automatehorizon.com/age-verification-laws-for-adult-websites/); [stateofsurveillance](https://stateofsurveillance.org/guides/basic/age-verification-laws-by-state/)
- Free Speech Coalition v. Paxton: SCOTUS upheld Texas HB 1181 6-3 on 27 June 2025 under intermediate scrutiny. — [Wikipedia](https://en.wikipedia.org/wiki/Free_Speech_Coalition_v._Paxton); [Super Lawyers](https://www.superlawyers.com/resources/internet/age-verification-laws-accessing-adult-content/)
- Texas HB 1181 (Civ. Prac. & Rem. Code ch. 129B): applies where more than one-third of content is sexual material harmful to minors. Penalties are up to $10,000/day for no verification, $10,000 per instance of retained identifying info, and up to $250,000 more if a minor accesses covered material. The verifier may not retain identifying information. — [ageonce](https://www.ageonce.com/blog/us-state-age-verification-laws-2026)
- Louisiana Act 440 (La. R.S. 9:2800.29), effective 1 Jan 2023: private right of action; accepts digitized ID, government ID or transactional data. — [ageonce](https://www.ageonce.com/blog/us-state-age-verification-laws-2026)
- Utah SB 287, effective 3 May 2023: private right of action. "Substantial portion" means more than 33-1/3% of total material on a website. The harmful-to-minors definition expressly includes "actual, simulated, or animated display or depiction" of sexual conduct. — [ageonce](https://www.ageonce.com/blog/us-state-age-verification-laws-2026); [Utah 78B-3-1001](https://law.counselstack.com/statute/ut/78B-3-1001)
- Virginia SB 1515 (Va. Code 8.01-40.5), effective 1 Jul 2023: civil liability. — [ageonce](https://www.ageonce.com/blog/us-state-age-verification-laws-2026)
- Indiana measures one-third as "at least one-third (1/3) of the images and videos published on the website" depicting harmful material. — [Indiana 24-4-23-1](https://law.counselstack.com/statute/in/24-4-23-1)
- Tennessee's Protect Tennessee Minors Act has a criminal provision and applies beyond commercial entities. The Sixth Circuit vacated the preliminary injunction on 4 Nov 2025. — [ageonce](https://www.ageonce.com/blog/us-state-age-verification-laws-2026)
- Indiana, South Dakota, Tennessee and Missouri reportedly apply to all covered sites, not only commercial ones. Florida, Indiana, Kansas, Kentucky and Wyoming apply only to residents of that state. — [ageonce](https://www.ageonce.com/blog/us-state-age-verification-laws-2026)
- The federal "harmful to minors" baseline (47 U.S.C. § 231) covers "any picture, image, graphic image file... or other visual depiction." — [Juneau definitions doc](https://juneau.org/wp-content/uploads/2022/05/Internet-Use-and-Safety-Definitions-Final-May-2022.pdf)
- Mississippi's broader social-media age law (HB 1126) led Bluesky to block Mississippi IPs in Aug 2025 after SCOTUS declined to block the law. Bluesky later returned for adults 18+ only. — [Route Fifty](https://www.route-fifty.com/digital-government/2025/08/bluesky-blocks-access-mississippi-citing-free-speech-and-privacy-concerns-over-age-verification-law/407680/); [Mississippi Free Press](https://www.mississippifreepress.org/bluesky-is-back-for-mississippi-adults-but-larger-social-giants-still-havent-implemented-required-age-checks/)
- Other minors/social-media laws relevant to a social-ish game: Virginia SB 854 (preliminarily enjoined 27 Feb 2026); Florida HB 3 (enforceable after the Eleventh Circuit stay on 25 Nov 2025); NY SAFE for Kids Act (effective 25 Jan 2027, AG-enforced, up to $5,000 per violation); California AADC (partly remanded or enjoined, 12 Mar 2026). — [ageonce](https://www.ageonce.com/blog/us-state-age-verification-laws-2026)
- **[unverified, check against FSC tracker]** States usually listed: Louisiana, Utah, Mississippi, Virginia, Arkansas, Texas, Montana, North Carolina, Indiana, Idaho, Florida, Kansas, Kentucky, Nebraska, Oklahoma, Alabama, South Carolina, Tennessee, Georgia, South Dakota, Wyoming, North Dakota, Arizona (HB 2112, effective Sep 2025), Missouri (AG rule, effective about Nov 30, 2025), Ohio (effective about Sep 30, 2025), plus West Virginia and Iowa in 2026. Arizona's and Missouri's tests reportedly differ from one-third. Missouri's rule reportedly covers sites where at least 33.3% of material is pornographic. Arizona reportedly applies one-third. Confirm each.
- **[unverified]** Texas HB 1181 defines "sexual material harmful to minors" to include "any material... including a picture, image, graphic image file, film... or other visual depiction" that describes actual or *simulated* sexual acts. That wording points toward drawn or AI imagery being covered.

### Inferences
- If 18+ content stays clearly under one-third of the whole site's material (measured however each statute measures it: images and videos in Indiana, "total material" in Utah), Aweborn is likely outside most one-third states. The risk is in how a court counts. Is a "world" a separate "website"? Do text, 3D assets and AI-mind chat logs count? Does an 18+-toggled subdomain or path count as its own site? A lawyer must answer these.
- Stylized, drawn or AI-generated explicit content should be assumed to count as "harmful to minors." Utah says "animated," and most definitions say "any... image" or "simulated." No statute found carves out non-photoreal content.
- States without a one-third threshold, and those with criminal exposure (Tennessee; also check Missouri, South Dakota, Arizona), are where geoblocking 18+ worlds or requiring a real age check is most defensible.
- Practical pattern: track the share of 18+ material, keep 18+ worlds on a separate path or subdomain, and run real checks (or block 18+) in states whose test Aweborn might meet or whose test isn't one-third.

### Gaps
- Did not fetch the FSC tracker directly. No verified per-state table of thresholds, penalties and PRAs for all 27 states.
- No case law found on whether AI-generated or cartoon content is "harmful to minors" under these laws, or on how "one-third" is measured for UGC platforms.

## Q3. US companion-chatbot laws (California SB 243, New York)

### Takeaway
Both apply to adult-only platforms. They require AI disclosure and self-harm crisis protocols for all users, and California adds minor-specific duties that kick in only when the operator knows the user is a minor. Neither mandates age verification. California has a private right of action; New York is AG-enforced at up to $15,000/day.

### Cited Findings
- New York AI Companion Models law, effective 5 Nov 2025: operators must take reasonable measures to detect and address self-harm or suicidal ideation and must remind users they are talking to an AI. AG enforcement, civil penalties up to $15,000/day, applies to all users. Sources disagree on the bill number (S-3008C vs A3008C). — [MoFo](https://www.mofo.com/resources/insights/251120-new-york-and-california-enact-landmark-ai); [Davis Polk](https://www.davispolk.com/insights/client-update/california-and-new-york-launch-ai-companion-safety-laws)
- California SB 243, signed 13 Oct 2025: applies to any operator making companion chatbots available to users in California. It adds duties when the operator knows a user is a minor, creates a private right of action, and sets up annual reporting phased in by 1 Jul 2027. Its "companion chatbot" definition is broad and doesn't require memory or unsolicited prompts. — [Skadden](https://skadden.com/insights/publications/2025/10/new-california-companion-chatbot-law); [FPF](https://fpf.org/blog/understanding-the-new-wave-of-chatbot-legislation-california-sb-243-and-beyond/); [MoFo](https://www.mofo.com/resources/insights/251120-new-york-and-california-enact-landmark-ai)
- SB 243 has no small-developer exemption. — [Product Hunt discussion](https://www.producthunt.com/p/murror/california-s-companion-chatbot-law-has-no-small-dev-exemption)
- Other states are adding companion-bot laws in 2026. — [Mondaq](https://www.mondaq.com/unitedstates/new-technology/1764488/state-companion-bot-laws-what-business-owners-need-to-know-in-2026)
- **[unverified]** SB 243 specifics: effective 1 Jan 2026. Clear AI disclosure where a reasonable person could be misled. A published suicide/self-harm protocol with crisis referrals. For known minors: break reminders every 3 hours and reasonable measures against sexually explicit content. Annual reports to the Office of Suicide Prevention from 1 Jul 2027. PRA damages of at least $1,000 per violation. NY's reminder is at session start and at least every 3 hours.

### Inferences
- Aweborn's "minds" probably qualify as companion chatbots under both laws. It needs AI-disclosure UI, a crisis-detection and referral protocol, and (California) reporting readiness. The 18+ gate lowers SB 243 minor-specific risk but doesn't remove the general duties.

### Gaps
- Didn't fetch the statute text. Exact definitions and exemptions (for example, game characters) need lawyer review.

## Q4. UK Online Safety Act: highly effective age assurance (HEAA)

### Takeaway
The OSA applies to a US site with UK users. Ofcom actively fines small foreign porn operators, although it struggles to collect. Services allowing user-generated pornography (Part 3) and publisher porn (Part 5) both need HEAA. Self-declaration and date-of-birth entry don't qualify; facial estimation, photo ID, credit card, open banking and similar methods do.

### Cited Findings
- Self-declaration and contractual under-18 bans aren't acceptable; DOB entry without verification fails the standard. — [VerifyMy summary of Ofcom guidance](https://verifymy.io/blog/ofcom-releases-official-guidance-on-highly-effective-age-assurance-for-pornography-providers); [Lewis Silkin](https://www.lewissilkin.com/insights/2025/01/16/a-new-age-ofcom-publishes-final-version-of-age-assurance-guidance-102ju6k)
- HEAA must be technically accurate, robust, reliable and fair; Ofcom set no numeric thresholds. Services with user-generated pornography had to have checks in place by July 2025. — [SCL](https://www.scl.org/ofcom-publishes-final-guidance-on-age-checks-to-protect-children-online/); [Ofcom age checks page](https://www.ofcom.org.uk/online-safety/protecting-children/age-checks-to-protect-children-online)
- Methods include facial age estimation and credit card checks. — [Evangelical Focus](https://evangelicalfocus.com/europe/30037/facial-estimation-or-credit-card-checks-uk-imposes-heavy-fines-on-websites-that-fail-to-verify-age-properly); [silicon.co.uk](https://silicon.co.uk/mobility/mobile-apps/ofcom-proposes-face-scanning-banking-details-for-porn-age-verification-542031)
- Ofcom and the ICO issued a joint age-assurance statement aligning OSA and data-protection duties (summer 2026). — [RPC](https://www.rpclegal.com/snapshots/data-protection/summer-2026/ofcom-and-ico-joint-statement-on-age-assurance/)
- Fines (2026):
  - 8579 LLC: £1.35m plus £50k for information failures (Feb 2026), the largest to date.
  - Kick Online Entertainment: £800k plus £30k.
  - Youngtek: £600k.
  - First Time Videos LLC: £80k.
  - Another £630k fine on 9 Jul 2026.
  - A file-sharing service: £20k.

  — [UKTN](https://www.uktech.news/news/government-and-policy/ofcom-issues-largest-ever-online-saftey-act-fine-20260223); [Inforrm](https://inforrm.org/2026/03/11/ofcom-steps-up-online-safety-act-enforcement-with-two-further-age-assurance-fines-for-pornographic-platforms-alexandros-antoniou/); [Computing](https://www.computing.co.uk/news/2026/legislation-regulation/ofcom-fines-porn-company-600k-under-the-online-safety-act); [RPC autumn 2026](https://www.rpclegal.com/snapshots/technology-digital/autumn-2026/online-safety-act-ofcom-fines-two-adult-sites-for-age-verification-failures/); [Ofcom](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/ofcom-fines-online-file-sharing-service-20000)
- More than £7m in fines across 11 providers, but "realistically the majority have not been paid." Ofcom's other levers are ISP blocking, payment-provider withdrawal and ad bans. Enforcement has focused on smaller porn companies. — [The Register, Sep 2026](https://www.theregister.com/security/2026/09/17/ofcom-discovers-issuing-online-safety-act-fines-is-easier-than-collecting-them/5297110)
- The OSA reaches foreign services accessible in the UK and likely to be used by children. — [Captain Compliance](https://captaincompliance.com/education/did-ofcom-fine-a-porn-company-for-failing-age-checks/); [Reed Smith](https://www.reedsmith.com/topics/uk-online-safety-act-2023/)
- Bluesky in the UK: the service stays open, and age verification is required only for certain content and features. That is a content-gating model, not a full block. — [Route Fifty](https://www.route-fifty.com/digital-government/2025/08/bluesky-blocks-access-mississippi-citing-free-speech-and-privacy-concerns-over-age-verification-law/407680/)
- **[unverified]** The OSA's definition of pornographic content covers content of a pornographic nature regardless of medium, which would include animated or AI-generated content. OSA statutory maximum fines are £18m or 10% of qualifying worldwide revenue, whichever is greater.

### Inferences
- The UK has no "one-third" safe harbour. Any UK-accessible 18+ world with explicit content (including stylized AI content and possibly sexual chat from "minds") needs HEAA before access, or UK users must be blocked from 18+ content. Bluesky-style gating (verify only to unlock 18+) matches Aweborn's planned "door" well.

### Gaps
- Didn't confirm in Ofcom's own text that animated or AI-generated pornography is in scope, or how Ofcom treats explicit AI chatbot text.

## Q5. EU, France, Italy, Germany, Australia, Canada, Brazil

### Takeaway
Real checks are required for porn access in France (Arcom, double-anonymity option), Italy (AGCOM, listed platforms), Australia (codes in force March 2026, including AI companion chatbots) and Brazil (ECA Digital, self-declaration banned, sanctions from Nov 2026). Canada's S-209 is not yet law. The EU-level app is voluntary, not a mandate.

### Cited Findings
- EU: the Commission declared its open-source age-verification app technically ready on 15 Apr 2026 and urged Member States to offer it by 31 Dec 2026 (non-binding Recommendation). France, Denmark, Greece, Italy, Spain, Cyprus and Ireland plan wallet integration. — [The Register](https://theregister.com/2026/04/29/eu_adopts_open_source_ageverification); [Usercentrics](https://usercentrics.com/knowledge-hub/age-verification-compliance-eu-uk/)
- A June 2026 CJEU ruling that a Member State can require age verification from services established elsewhere in the EU was reported by Usercentrics only. It is unconfirmed. — [Usercentrics](https://usercentrics.com/knowledge-hub/age-verification-compliance-eu-uk/)
- France: the SREN law (Loi 2024-449) lets Arcom fine, block or delist non-verifying porn services. The Arcom standard has been binding since Jan 2025, with the double-anonymity option mandatory since 11 Apr 2025. At least two methods are required, one of them double-blind. — [Usercentrics](https://usercentrics.com/knowledge-hub/age-verification-compliance-eu-uk/)
- Italy: AGCOM Resolution 96/25/CONS has applied to 48 listed platforms since 12 Nov 2025, with fines up to €258,228 and blocking. — [Usercentrics](https://usercentrics.com/knowledge-hub/age-verification-compliance-eu-uk/)
- Australia: Age-Restricted Material Codes took full effect March 2026. They cover porn sites, app stores, gaming and generative AI, including companion chatbots. Companion chatbots able to generate sexually explicit material must confirm users are 18+ before access, or else prevent such content. An "I am 18" button no longer suffices. — [eSafety media release](https://esafety.gov.au/newsroom/media-releases/online-safety-codes-introduce-real-world-protections-for-children-online); [eSafety fact sheet Apr 2026](https://www.esafety.gov.au/sites/default/files/2026-04/Age-restricted-Material-Codes-fact-sheet-April2026.pdf); [Biometric Update](https://www.biometricupdate.com/202603/australia-expands-age-checks-to-ai-chatbots-app-stores-porn-sites-and-more)
- eSafety's March 2026 report found Character.AI, Nomi, Chai and Chub AI had no meaningful age checks. Character.AI then added age assurance in Australia, Chub AI geoblocked Australia, and Nomi committed to adding checks. — [eSafety report release](https://esafety.gov.au/newsroom/media-releases/esafety-report-shows-ai-companions-are-putting-children-at-risk); [Biometric Update](https://www.biometricupdate.com/202603/companion-chatbots-not-doing-enough-to-protect-kids-esafety-report)
- Canada S-209 (Protecting Young Persons from Exposure to Pornography Act): passed the Senate 15 Apr 2026. It was reportedly at House second reading on 28 Oct 2026 and referred to the HUMA committee; dates conflict between sources. Not in force. Methods would be set by regulation, and courts could order blocking. — [Didit, Oct 31 2026](https://didit.me/blog/age-verification-canada/); [Reclaim The Net](https://reclaimthenet.org/bill/ca-bill-s209-age-verification)
- Brazil ECA Digital (Lei 15.211/2025): in force 17 Mar 2026 with Decree 12.880. The ANPD is the regulator. Self-declaration is expressly prohibited (Art. 9 per law-firm notes). ANPD preliminary age-assurance guidance came out 20 Mar 2026. Administrative sanctions start Nov 2026 and formal enforcement Jan 2027. — [ANPD English page](https://www.gov.br/anpd/pt-br/assuntos/eca-digital/eca-digital-english); [Mayer Brown, Apr 2026](https://www.mayerbrown.com/en/insights/publications/2026/04/enforcement-of-brazils-eca-digital-introduces-new-obligations-for-companies); [Mattos Filho](https://www.mattosfilho.com.br/unico/decreto-regulamentar-eca-digital/); [Shufti](https://shuftipro.com/blog/brazil-age-verification-law-lei-15211/)
- **[unverified]** Australia's under-16 social media minimum age took effect 10 Dec 2025. A game is probably outside the "age-restricted social media platform" definition, but that needs checking. Germany's JMStV requires KJM-approved "closed user groups" with strong age verification for pornography; facial estimation and similar systems have received KJM positive assessments. No 2026 source was fetched for Germany.

### Inferences
- Strict-check jurisdictions for Aweborn's 18+ worlds (real check or block): UK, France, Italy (if listed, though AGCOM's scope may grow), Germany, Australia (explicitly including sexual AI chatbots), Brazil, plus US states whose test Aweborn might meet. EU-wide, the DSA doesn't mandate checks for small platforms, but national laws do.

### Gaps
- Germany JMStV/KJM 2026 status not verified. Italy's applicability to non-listed sites unclear. No research done on other countries (India, South Korea, Japan, and so on).

## Q6. Practical options: geoblocking vs. checks, and how other platforms handled it

### Takeaway
Platforms use three patterns: block the jurisdiction (Bluesky in Mississippi, Chub AI in Australia), gate only sensitive content behind a check (Bluesky UK, Discord UK and Australia), or verify everyone (Discord global plan, delayed). For Aweborn, gating only 18+ worlds, checking or blocking per jurisdiction, and choosing an on-device or immediate-deletion vendor matches what peers do.

### Cited Findings
- Bluesky blocked Mississippi IPs because a small team lacked resources to comply, then returned for 18+ only. In the UK it gates only certain content and features. — [Engadget](https://www.engadget.com/social-media/bluesky-blocks-mississippi-due-to-its-new-age-verification-law-133049512.html); [Mississippi Free Press](https://www.mississippifreepress.org/bluesky-is-back-for-mississippi-adults-but-larger-social-giants-still-havent-implemented-required-age-checks/)
- Discord delayed global age verification to H2 2026 after backlash, cut ties with Persona over on-device processing, uses k-ID globally, and continues UK and Australia trials. — [VGC](https://www.videogameschronicle.com/news/we-missed-the-mark-discord-is-delaying-global-age-verification-until-its-improved-the-process); [idtechwire](https://idtechwire.com/discord-delays-global-age-verification-to-h2-2026-cuts-ties-with-persona/); [Boston Globe](https://www.bostonglobe.com/2026/02/25/business/discord-postpones-age-verification)
- Reddit uses Persona. The ICO fined it £14.47m for unlawfully processing children's data, which shows that collecting age data itself carries risk. — [technobezz](https://www.technobezz.com/news/reddit-faces-a-145-million-uk-fine-over-inadequate-age-verification-checks); [EFF](https://www.eff.org/deeplinks/2026/02/discord-voluntarily-pushes-mandatory-age-verification-despite-recent-data-breach)
- Chub AI geoblocked Australia rather than add checks. Character.AI added age assurance for Australians. — [Biometric Update](https://www.biometricupdate.com/202603/companion-chatbots-not-doing-enough-to-protect-kids-esafety-report)
- **[unverified]** X uses age estimation in the UK and EU for sensitive media.

### Inferences
- A geo-IP check that defaults to "18+ hidden unless verified" in listed jurisdictions is cheap. VPN evasion is the user's problem in most regimes, though Ofcom expects reasonable anti-circumvention. Checking instead of blocking keeps adult users in high-value markets (UK, AU, FR) at roughly $0.10-$1.50 per one-time check.
- Keep a maintained jurisdiction list. Laws changed many times in 2025-2026 (injunctions lifted, new states, Brazil sanctions starting Nov 2026).

### Gaps
- No verified data on how X or Reddit gate NSFW in specific US states. No cost data on geoblocking services.
