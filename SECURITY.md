# Security reporting

Please report vulnerabilities privately through this repository's **Security → Report a vulnerability** flow. Do not include real documents, tokens or credentials in public issues. If private reporting is unavailable, open a minimal issue asking for a private reporting channel without disclosing exploit details.

Supported release line: 0.1.x. Security fixes are published as new tagged releases; install the updated tarball and restart the workspace service.

Studio is a local single-user design application. It is not intended to run on a public interface or provide isolation from an attacker with write access to the workspace or the same OS account. Relevant reports include origin/authentication bypasses, unsafe document execution, filesystem escapes, asset parser issues, private-data leakage and persistence/concurrency failures that destroy work.
