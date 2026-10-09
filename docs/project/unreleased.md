# Unreleased changes

- Plugins can query supported fetch redirect modes and explicitly refuse or
  inspect redirects without following them. Existing calls keep following by
  default; a local-only probe plugin demonstrates the new API.
- Use Pi 1.1.0's 3.5-character text estimate for compaction limits and its
  monotonic request duration for completed-response throughput; interrupted
  streams keep the existing fallback.
