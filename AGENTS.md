# Before committing

Use `.agents/skills/precommit-check/SKILL.md` before a Git commit. Run its automated gate and review the root README and affected documentation against the changed implementation. A passing shell command alone does not establish documentation accuracy.

When asked to repair gate failures, use `.agents/skills/precommit-fix/SKILL.md`, update stale documentation and code examples, and rerun the complete check. Keep repairs unstaged unless staging was requested. A check or fix request does not by itself authorize a commit.
