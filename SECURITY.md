# Security Policy

## Supported versions

Security fixes are released for the latest version of Melo. Please update to the [latest release](https://github.com/melo-libs/melo/releases/latest) before reporting an issue.

## Reporting a vulnerability

Please **do not** open a public issue, discussion, or pull request for security problems.

Report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Include:

- the Melo version and macOS version
- what an attacker could do, and under which conditions
- steps or a proof of concept to reproduce it

We will acknowledge your report, keep you updated while we investigate, and credit you in the release notes if you wish.

## Scope

Areas of particular interest include:

- reading or writing files outside the chosen workspace
- content from clipped web pages, pasted text, or opened files executing code
- exposure of API keys or account credentials stored by the assistant
- the update mechanism
