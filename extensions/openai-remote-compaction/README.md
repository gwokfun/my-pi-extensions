# OpenAI remote compaction

This extension uses the OpenAI Responses compact endpoint for models whose API is
`openai-responses` or `openai-codex-responses` and whose model ID or name contains
`gpt`. All other models keep Pi's native compaction path.

The successful response is stored in the compaction entry details and replayed on
the next request for the same provider, API, base URL, and model. The readable text
returned by the endpoint is kept as Pi's summary so switching to another model
remains safe.

If authentication, the endpoint, the response, or the timeout fails, the extension
returns control to Pi's native compaction. There is no extension configuration file.
