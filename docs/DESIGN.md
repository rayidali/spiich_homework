# Daybook design record

> Updated 2026-10-29. The simpler interface is implemented in source and compiles; its current browser/device verification is pending because this session cannot launch the test browser. Screenshots below document the earlier verified design. See [CHECKPOINT.md](../CHECKPOINT.md).

Daybook is the product name. Spiich is the company receiving the engineering assignment. The interface, page title, favicon, exported filenames, package, and Compose project use Daybook.

## Latest user feedback: simplification requested

On 2026-10-29 the user reported that the interface was confusing and exposed too much at once. After the architecture report they authorized implementation. The new flow is implemented; the screenshots further below remain the earlier baseline until browser verification is possible.

| Earlier design                                         | Current source                                                        | Reason                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Five primary destinations and several shortcuts        | Home, Transactions, Reports, Settings                                 | Fewer top-level choices; account/recurrence tools remain accessible |
| Metrics, chart, expenses and assistant compete on Home | Cash, profit, recording action, review queue and recent transactions  | Make the next task clear                                            |
| Detailed financial analysis always visible             | Expandable detail with the exact chart table and drill-downs retained | Keep useful depth available                                         |
| Immediate debit/credit form                            | Simple USD form, explicit account-effects review, then confirmation   | Explain the effect before posting                                   |
| AI conversation and full journal fields shown together | Clarification first, then structured review                           | Separate missing information from a ready proposal                  |

The short form requires an explicit category/account. Money received for an existing invoice credits receivables; equity and loan receipts are also supported. Outgoing liability payments reduce debt, and transfers move between cash accounts. Foreign currency and split transactions use the full journal mode. Review displays debit/credit lines, amounts, increases/decreases and recorded rates. These remain clients of the same validated posting API; they do not create another ledger implementation.

The downloaded Emil design/mobile guidance was applied again. An independent code review found and corrected an ineligible default account on customized charts and editing controls that could race an in-flight preparation/posting request. The browser suite now includes short-form accounting and a mocked AI clarification/review workflow; runtime success and layout quality remain to be checked.

The name refers to the daily journal at the center of bookkeeping. The small line-drawn mark combines a D with a book's spine and ledger lines. It is an SVG implemented in the repository; there are no generated bitmap assets or external font requests.

## Source and application

Downloaded a snapshot of [Emil Kowalski's skills repository](https://github.com/emilkowalski/skills) on 2026-10-28. The local copy is `.tools/design-skills/skills-main`, with download provenance in `.tools/design-skills/source.json`.

- Revision: `a81dbca07f2217b7103e510c0f13f8d5b017afc9`.
- Archive SHA-256: `c6049bced8f3a2045a5af83136918c28ea95c68c3088c031eff21dc40f8733c1`.
- Applied `skills/emil-design-eng/SKILL.md`, `ui-cheatsheet.md`, and `skills/mobile-native/SKILL.md`.
- This is a project-local download, not a global Codex skill installation. The downloaded repository is local tooling and is excluded from the submission archive.

The skills informed interaction frequency, press feedback, motion curves, typography, hover capability queries, touch controls, and mobile viewport handling. The product layout and visual identity were implemented specifically for this accounting application.

## Interface review

| Before                                                | After                                                                             | Why                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Company name used as the product                      | Daybook identity, wordmark, favicon, exports, and package                         | Makes the product distinct from the assignment's recipient                 |
| Mint surfaces and promotional AI panels               | White workspace, warm neutral sidebar, restrained clay mark, dark primary actions | Keeps the journal and balances in the foreground                           |
| Four separate pastel metric cards                     | One divided financial summary                                                     | Makes related amounts easier to compare                                    |
| Smoothed area chart with a decorative gradient        | Grouped monthly bars and an expandable exact-values table                         | Shows discrete periods directly; numeric detail is available without hover |
| Repeated AI slogans and sparkle icons                 | Direct labels and a compact assistant section                                     | Explains the feature without marketing language                            |
| Drafts in a small bottom card                         | Drafts and anomaly alerts together in the review column                           | Puts outstanding work where it can be found quickly                        |
| Tiny text and soft contrast                           | Readable table type, tabular numerals, consistent control sizes                   | Helps users scan dates, accounts, and amounts                              |
| Scaled-down chart labels on phones                    | Chart coordinates adapt to the measured container width                           | Preserves label size as the layout narrows                                 |
| Mobile recent-entry amounts outside the visible table | Amounts stay visible; date and status move below the description                  | Keeps the important facts together without horizontal scrolling            |
| Unconditional smooth chat scrolling                   | Immediate chat scrolling                                                          | Avoids motion during repeated conversational actions                       |
| Hover rules on every device                           | Hover styles gated by pointer capability                                          | Avoids sticky hover behavior on touch devices                              |
| Sidebar overlay without keyboard containment          | Focus trap, Escape, focus restoration, inert background                           | Keeps keyboard navigation inside the open mobile menu                      |

On phones, entry lines stack the account above labeled debit and credit inputs, keeping the entire input row visible. The ledger tables that need many columns still scroll inside their own containers. The page itself fits the viewport. Nothing is hidden merely to make the desktop screenshot cleaner.

## Motion and platform decisions

Charts, amounts, navigation, tabs, and expanded chart data do not animate. An occasional dialog uses a 180ms opacity/transform entrance; a side drawer uses a 220ms entrance. Buttons have a 130ms pointer-press response. Keyboard-triggered dialogs and controls skip decorative motion, and reduced-motion preferences disable it throughout.

Touch-capable devices receive 16px form text and larger primary controls. The viewport permits zoom. Dynamic viewport units keep drawers within the visible browser area; safe-area padding reserves room for device edges. Scroll containment applies to nested tables, conversations, and dialog bodies. Body text remains selectable.

The mobile menu also traps focus, closes with Escape, restores focus to its trigger, and closes when the layout returns to desktop. Toast timers are replaced when a newer notification arrives, so an old timer cannot dismiss a new message.

## Accounting behavior

The new interface uses the existing journal, reporting, recurrence, anomaly, and AI APIs. No accounting migration or posted record was changed for branding. Dashboard links retain the selected date range when opening transactions, reports, or an expense account.

The chart uses JavaScript numbers only to calculate drawing coordinates. Labels, table amounts, posting checks, reports, and persisted values continue to use exact monetary formatting and database decimal arithmetic. Negative chart amounts are drawn below the zero baseline.

Existing PostgreSQL database and role identifiers retain their original internal names. Applied migrations have checksums and must not be rewritten for a product rename. Compose is named `daybook` and explicitly reuses the original `spiich_postgres_data` volume name to preserve any existing container data.

## Verification and evidence

The production build and eight Playwright workflows passed in Chromium/Brave. Coverage includes posting/reversal, account CRUD, reports, recurrence, anomaly review, chart data, keyboard focus, reduced motion, and a touch-enabled 390px browser context. The original 37 database/provider-contract tests remain part of the suite.

Desktop screenshots: [overview](evidence/dashboard.png), [transactions](evidence/transactions.png), [accounts](evidence/chart-of-accounts.png), [reports](evidence/reports.png), [recurrence](evidence/recurring.png), [journal form](evidence/journal-form.png), and [assistant](evidence/assistant.png). Mobile evidence: [touch overview](evidence/mobile-touch.png) and [journal form](evidence/mobile-journal.png). The [previous overview](evidence/before-dashboard.png) records the starting design.

**Physical-device verification remains pending.** CSS, focus, overflow, reduced motion, and input sizes were checked in code and browser emulation. Real iPhone/Android keyboard behavior, Safari rubber-banding, browser chrome, sticky hover, and safe areas cannot be established by that evidence. The mobile skill specifically calls for a real-device check; none is claimed here.

## How to explain the change

“I designed Daybook around the daily review loop: see balances, inspect the journal, review drafts and unusual activity, then post or investigate. AI remains available at the point of work. I used restrained surfaces and aligned numeric columns so the financial information has the strongest hierarchy. The motion rules depend on how often someone performs an action, and the mobile layout preserves useful amounts rather than shrinking the desktop screen.”
