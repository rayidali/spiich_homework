# Historical R0 source snapshots

These two nonexecuted `.ts.txt` files preserve the exact production source used to design the research R0 control, from commit [`7ecb435c421862dba5efd4e3b6f743c93fd1888e`](https://github.com/rayidali/spiich_homework/tree/7ecb435c421862dba5efd4e3b6f743c93fd1888e). They were extracted byte for byte from that commit's Git objects after the study, when a later product repair exposed a test that incorrectly required current production files to remain unchanged forever.

`origin.json` records the repository, original paths, commit, SHA-256 checksums and Git blob IDs. Extraction verified both checksums against the existing, unchanged `baselineProvenance` values in `research/baseline.ts`. The test checks those same historical hashes and blob IDs without requiring Git history, network access or private local files in CI.

These are provenance fixtures, not current application code or files executed during the experiment. The original research source, results, hashes and declared adaptations remain unchanged. Production may evolve independently. Keep snapshot bytes intact; do not run formatters over the `.ts.txt` files.
