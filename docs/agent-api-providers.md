# Agent API providers

Melo stores API service identity independently of the Claude Code/Codex Harness.
Each Harness has one saved API profile. Switching Harness or account/API mode
preserves that profile; changing to another API service requires its own key.

## Connection flow

Select a service, enter its key, open the model list, choose a model, then connect.
The list loads on demand and uses the shared Select. Loading appears inside the
menu and preserves the selected value. Successful catalogs are cached in memory;
Refresh explicitly queries again. Queries never change saved connection settings.
Custom services retain manual model entry, with optional discovery. Built-ins also
allow manual entry when a model is missing from the directory.

A directory is not proof of model access. Connect sends a short Messages or
Responses request, with no workspace content, before saving the connection.
Model permissions, balance and client eligibility still depend on the provider.
Melo does not spoof a supported client's identity for subscription products.

## Endpoint and authentication policy

The entries below were checked against official documentation on **2026-10-30**.
Base URLs do not include the final `/v1/messages` or `/responses` operation.

| Service           | Claude Code base URL                     | Codex base URL                    | Catalog                                |
| ----------------- | ---------------------------------------- | --------------------------------- | -------------------------------------- |
| DeepSeek          | `https://api.deepseek.com/anthropic`     | —                                 | Remote `/models`                       |
| Zhipu API         | `https://open.bigmodel.cn/api/anthropic` | `https://open.bigmodel.cn/api/v1` | Verified built-in directory            |
| Zhipu Coding Plan | `https://open.bigmodel.cn/api/anthropic` | `https://open.bigmodel.cn/api/v1` | Verified built-in directory            |
| Kimi API          | `https://api.moonshot.cn/anthropic`      | `https://api.moonshot.cn/v1`      | Remote `/v1/models`                    |
| Kimi Code         | `https://api.kimi.com/coding`            | `https://api.kimi.com/coding/v1`  | Verified built-in directory            |
| Anthropic         | `https://api.anthropic.com`              | —                                 | Remote `/v1/models`, cursor pagination |
| OpenAI            | —                                        | `https://api.openai.com/v1`       | Remote `/v1/models`                    |
| Custom            | User supplied                            | User supplied                     | Optional protocol-relative discovery   |

Claude uses Bearer authentication for DeepSeek/Kimi API and `x-api-key` for
Zhipu, Kimi Code, Anthropic and Custom. Codex uses Bearer authentication.
DeepSeek is offered under Claude Code only: the currently installed Codex emits
namespace tools, while DeepSeek documents flat function tools. Codex presets omit
that combination; a saved incompatible profile returns an explicit compatibility
error. Custom remains available for gateways that implement the required format.

Custom addresses must expose the protocol required by the selected Harness.
For example, a Chat Completions-only endpoint does not satisfy Codex's Responses
requirement. Alternative regions or gateways can be entered as Custom.

Zhipu's current guides share Messages/Responses endpoints between regular API
and Coding Plan. Persisted `apiService` distinguishes those billing products even
when the URL is identical. Kimi API and Kimi Code use separate URLs and model IDs.
Their credentials are not interchangeable.

Directory metadata retains documented tool support, image input, context limits
and effort levels when available. It does not claim to enforce context budgets
or enable image ingestion/API effort controls in Melo. Codex API sessions pin a
compatible `high` effort for known models that advertise it, otherwise the Harness
`medium` default, instead of inheriting Terminal's selected effort. Explicitly non-tool and
specialized audio/image/embedding models are excluded. Kimi discovery uses the
model subset verified for these protocols; other IDs can be entered manually.

If remote discovery fails, a matching cached or verified built-in directory is
shown with the failure. Otherwise the menu offers retry and manual entry. Built-in
directories show their verification date. No failure is interpreted as a successful
connection, and no undocumented model-list endpoint is guessed for Coding Plans.

## Ownership and security

- `shared/agentApi.ts`: service profiles, verified catalogs and key-scope rules.
- `main/agent/runtime/apiModels.ts`: bounded catalog reads, parsing, filtering,
  per-Harness/service/endpoint/key caching, and explicit refresh/fallback.
- `main/agent/runtime/apiConnection.ts`: endpoint validation, authenticated
  protocol probes and sanitized transport/provider errors.
- `main/agent/runtime/claudeAccess.ts`: the matching Claude subprocess auth policy.
- `main/agent/storage/agentSettings.ts`: encrypted keys and persisted service identity.
- `renderer/.../AgentApiModelField.tsx`: transient catalog state and stale-response
  rejection when a draft key or endpoint changes; shared Select rendering.

Saved keys are reusable only for the same canonical endpoint **and** service ID.
Catalog/probe requests reject redirects, embedded credentials and non-HTTPS addresses other than
loopback fixtures. Catalog bodies, pagination and cache size are bounded. Cache
identities hash credentials; raw provider payloads and credentials are not exposed
through errors. Keys are encrypted through Electron safeStorage.

Older Claude DeepSeek/Anthropic and Codex OpenAI profiles keep their identity.
Other older profiles (including Codex DeepSeek endpoints) remain Custom; a newly introduced preset never takes ownership of a legacy key.
Claude API routing is restricted to Melo-owned subprocess environment variables,
including model-tier overrides. Codex API routing is pinned both at owned process launch and in session settings.
Its key is supplied through a dedicated child environment variable, never argv or
an account login command. Each turn uses a fresh MCP identity while retaining the
warm adapter process, preventing stale tool connections. The pinned ACP patch
supports disabling automatic title generation in Melo, avoiding background calls
to a hard-coded GPT model. Native CLI settings and authentication files are not
changed by provider selection, catalog discovery or API turns.

## Official sources

- DeepSeek: [catalog](https://api-docs.deepseek.com/api/list-models/),
  [Messages](https://api-docs.deepseek.com/guides/anthropic_api/),
  [Responses](https://api-docs.deepseek.com/guides/responses_api/).
- Zhipu: [Messages](https://docs.bigmodel.cn/cn/guide/develop/claude/introduction),
  [Responses](https://docs.bigmodel.cn/cn/guide/develop/responses/introduction),
  [Coding Plan endpoints](https://docs.bigmodel.cn/cn/coding-plan/tool/others),
  [Coding Plan models](https://docs.bigmodel.cn/cn/coding-plan/latest-model).
- Kimi API: [catalog](https://platform.kimi.com/docs/api/list-models),
  [Messages](https://platform.kimi.com/docs/api/messages),
  [Responses](https://platform.kimi.com/docs/api/responses).
- Kimi Code: [protocols](https://www.kimi.com/code/docs/),
  [models](https://www.kimi.com/code/docs/kimi-code/models.html),
  [Claude Code authentication](https://www.kimi.com/code/docs/third-party-tools/claude-code.html).
- [Anthropic catalog](https://platform.claude.com/docs/en/api/models/list).
- [OpenAI catalog](https://developers.openai.com/api/reference/resources/models/methods/list).

## Verification

Unit fixtures cover service/protocol/auth policies, catalog parsing, pagination,
cache/refresh, safe failures, metadata filtering, and credential scope. Renderer
fixtures cover stable selections, popup loading, retry, manual entry, and rejecting
responses for an old key. The isolated Electron Agent E2E exercises the shared
Select through IPC against a local catalog, connects with a protocol request, then
runs Claude ACP tool calls, approvals and undo. `MELO_CLAUDE_API_CHECK=1` exercises
the installed Claude adapter for all service/auth profiles. `MELO_CODEX_API_CHECK=1`
exercises Codex with Custom, Kimi API/Code, and Zhipu API/Coding Plan: two fresh
sessions each, real MCP calls, selected-model/effort checks, and an unchanged
file-backed native preference. These checks use local fixtures and empty temporary
CLI homes; they do not verify live provider entitlement. No developer account is
used.
