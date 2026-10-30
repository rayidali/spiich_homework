# Daybook continuation instructions

Read [CHECKPOINT.md](CHECKPOINT.md) first when starting or resuming work. It records the saved state as of 2026-10-29, user preferences, verified checks, runtime recovery, and outstanding work. Then read the relevant project documents; do not rebuild the implemented application from scratch.

- Product name: **Daybook**. Spiich is the assignment's recipient. Keep the independent identity. After reviewing the visual report, the user authorized beginning the Gemini integration, evaluation, and simpler interface. Continue from the existing application.
- The user authorized AI-assisted implementation and wants clear decision logs and explanations they can rehearse. Update `docs/BUILD_LOG.md` and affected documentation when making meaningful changes.
- Latest user preference: **paid Jev and other models/services are acceptable when justified**. The user saved `GEMINI_API_KEY` in private `.env` after clipboard access failed. Never display its contents. Gemini/OpenAI support, a 40-case evaluation harness and UI simplification are implemented. Current isolated tests: **51 passing**; build and Compose config pass. Live key validity is unknown because provider DNS failed. Jev and vector search remain optional experiments.
- Preserve posted history, exact decimal arithmetic, database invariants, applied migration checksums, `.tools/postgres`, and the existing named Compose volume. Inspect current processes before starting servers; use the recovery branches in the checkpoint.
- Downloaded design guidance is in `.tools/design-skills/skills-main`; source provenance and applied skills are documented in `docs/DESIGN.md`. This is local tooling, not a globally installed skill package.
- Test changes appropriately. The earlier 29 database tests + 8 provider contracts + 8 browser workflows are historical. Current 29 database + 14 AI-contract and 10 browser workflows are pending: local sockets fail `EPERM` and browser launch aborts. No Docker runtime is installed. Do not bypass environment restrictions, claim old screenshots show the new UI, or claim million-user capacity/live accuracy/physical-device behavior without evidence.
- Keep secrets out of source/docs/screenshots/archives. Refresh `submission.zip` if source or documentation changes. It currently uses the `daybook-ledger/` root.
- No Git repository or commit exists: creating `.git` was denied by the filesystem during implementation startup. The pre-implementation ZIP is preserved at `.tools/checkpoints/before-gemini-implementation-2026-10-29.zip`; do not reset source/database files from it during normal work.

These notes support continuity; the user's next request determines the work to do.
