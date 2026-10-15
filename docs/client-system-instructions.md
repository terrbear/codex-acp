# Client system instructions

ACP clients can negotiate `clientCapabilities._meta["ahpd.clientSystemInstructions"]: {"version": 1}` in `initialize`. A supporting server returns the same capability under the response `_meta`. This extension does not opt the client into AIR rendering or change tool-output, permission, or approval behavior.

For a new session, send `_meta["ahpd.clientSystemInstructions"]` as a nonempty UTF-8 string of at most 128 KiB in `session/new`. The adapter passes that exact string to Codex `thread/start` as `developerInstructions`. Invalid values are rejected before creating a thread, and error data does not include instruction content. User prompt text remains separate. If both this extension and AIR custom instructions are supplied, this extension takes precedence; malformed explicit input is rejected rather than falling back.

The existing Codex thread owns its instructions on `session/load`. This extension does not retrofit a prompt into a pre-existing thread. Start a new session to change instructions. A transport acknowledgment is not a guarantee of model compliance.
