# Unreleased changes

- Plugins can query supported fetch redirect modes and explicitly refuse or
  inspect redirects without following them. Existing calls keep following by
  default; a local-only probe plugin demonstrates the new API.
