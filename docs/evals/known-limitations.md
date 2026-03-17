# Goose Evaluation Known Limitations

These golden scenarios give the repository a stable regression surface for the goose-backed runtime path, but they are intentionally narrow.

Current limitations:
- The eval harness uses deterministic in-memory stubs for goose and quality-gate responses rather than the live goose CLI.
- Golden runtime snapshots compare compact summaries, not full persisted runtime artifacts, so timestamp-level drift is intentionally out of scope.
- The happy-path and retry-recovery scenarios assert behavior directly in tests instead of storing additional runtime golden files.
- Event messages remain contract-sensitive: changing reporting copy may require fixture updates even when runtime behavior is unchanged.
- CLI-driven goose delivery is still out of scope for this slice and is covered by Task 8.
