"""Black-box safety regressions; all mutations are confined to temporary repos."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("cleanup.sh").resolve()
REAL_GIT = shutil.which("git")


class CleanupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cleanup-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.env = {
            **os.environ,
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "REAL_GIT": REAL_GIT,
        }
        for key in list(self.env):
            if key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"):
                del self.env[key]
        self.git("init", "-b", "canary")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        (self.repo / ".gitignore").write_text(".env\nnode_modules/\n")
        self.git("add", ".gitignore")
        self.git("commit", "-m", "base")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.git("remote", "add", "origin", "https://github.com/example/repo.git")
        self.git("update-ref", "refs/remotes/origin/canary", self.base)
        self.worktree = self.root / "topic"
        self.git("worktree", "add", "-b", "topic", str(self.worktree))
        self.env["TEST_WORKTREE"] = str(self.worktree)
        self.write_executable("gh", """#!/usr/bin/env bash
set -eu
[[ " $* " == *' --repo example/repo '* ]] || exit 7
if [[ ${GH_FAIL:-0} == 1 ]]; then exit 1; fi
if [[ ${MUTATE:-} == dirty ]]; then echo work > "$TEST_WORKTREE/new-work"; fi
if [[ ${MUTATE:-} == commit ]]; then
  "$REAL_GIT" -C "$TEST_WORKTREE" commit --allow-empty -qm concurrent
  printf '1\tMERGED\t%s\tcanary\texample/repo\n' "$("$REAL_GIT" -C "$TEST_WORKTREE" rev-parse HEAD)"
  exit
fi
printf '%s' "${PR_ROWS:-}"
""")

    def write_executable(self, name, content):
        path = self.bin / name
        path.write_text(content)
        path.chmod(0o755)

    def git(self, *args, cwd=None):
        return subprocess.check_output(
            [REAL_GIT, *args], cwd=cwd or self.repo, env=self.env, text=True,
            stderr=subprocess.DEVNULL,
        )

    def run_cleanup(self, *args, cwd=None):
        return subprocess.run(
            ["bash", str(SCRIPT), *args], cwd=cwd or self.repo,
            env=self.env, text=True, capture_output=True,
        )

    def clean(self, *args, cwd=None):
        return self.run_cleanup("clean", "--branch", "topic", *args, cwd=cwd)

    def assert_retained(self, result, message):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(message, result.stderr)
        self.assertTrue(self.worktree.exists())
        self.git("show-ref", "--verify", "refs/heads/topic")
        self.assertNotIn("REMOVED-BRANCH", result.stdout)

    def unique_commit(self):
        self.git("commit", "--allow-empty", "-m", "feature", cwd=self.worktree)
        return self.git("rev-parse", "topic").strip()

    def pr(self, state, head, repo="example/repo", base="canary"):
        self.env["PR_ROWS"] = f"1\t{state}\t{head}\t{base}\t{repo}\n"

    def test_dry_run_and_successful_removal(self):
        result = self.clean()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("DRY-RUN", result.stdout)
        self.assertTrue(self.worktree.exists())
        result = self.clean("--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"(was {self.base})", result.stdout)
        self.assertFalse(self.worktree.exists())
        self.assertNotIn("refs/heads/topic", self.git("show-ref"))

    def test_current_worktree_from_subdirectory_and_symlink(self):
        sub = self.worktree / "sub"
        sub.mkdir()
        link = self.root / "link"
        link.symlink_to(sub, target_is_directory=True)
        for cwd in (sub, link):
            self.assert_retained(self.clean("--apply", cwd=cwd), "protect-current")

    def test_noise_lookalikes_and_special_paths_remain_dirty(self):
        for name in ("node_modules-plan.md", "node_modules-backup", "line\nbreak", 'a"b'):
            path = self.worktree / name
            path.write_text("valuable")
            self.assert_retained(self.clean("--apply"), "protect-dirty")
            path.unlink()

    def test_ignored_secrets_protected_even_if_status_config_hides_untracked(self):
        self.git("config", "status.showUntrackedFiles", "no")
        (self.worktree / ".env").write_text("placeholder")
        self.assert_retained(self.clean("--apply"), "protect-dirty")

    def test_ignored_noise_can_be_removed_without_force(self):
        directory = self.worktree / "node_modules"
        directory.mkdir()
        (directory / "generated").write_text("cache")
        result = self.clean("--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.worktree.exists())

    def test_untracked_noise_is_not_force_removed(self):
        directory = self.worktree / ".goal-tracing"
        directory.mkdir()
        (directory / "output").write_text("trace")
        self.assert_retained(self.clean("--apply"), "worktree removal failed")

    def test_invalid_regex_and_local_base_refused(self):
        self.assert_retained(self.clean("--apply", "--noise", "["), "invalid noise regex")
        self.assert_retained(self.clean("--apply", "--base", "canary"), "remote-tracking")

    def test_status_failure_does_not_become_clean(self):
        self.write_executable("git", """#!/usr/bin/env bash
for arg in "$@"; do if [[ $arg == status ]]; then exit 1; fi; done
exec "$REAL_GIT" "$@"
""")
        self.assert_retained(self.clean("--apply"), "cannot inspect status")

    def test_github_failure_does_not_become_no_pr(self):
        self.env["GH_FAIL"] = "1"
        self.assert_retained(self.clean("--apply", "--gh"), "PR lookup failed")

    def test_merged_and_closed_pr_allow_uncovered_exact_head(self):
        tip = self.unique_commit()
        for state in ("MERGED", "CLOSED"):
            self.pr(state, tip)
            result = self.clean("--gh")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(f"candidate-pr-{state.lower()}", result.stdout)

    def test_different_merged_head_is_review_not_assumed_ahead(self):
        self.unique_commit()
        self.pr("MERGED", self.base)
        self.assert_retained(self.clean("--apply", "--gh"), "review-pr-merged-different")

    def test_closed_different_head_requires_remote_coverage(self):
        tip = self.unique_commit()
        self.pr("CLOSED", self.base)
        self.assert_retained(self.clean("--apply", "--gh"), "review-no-upstream")
        self.git("update-ref", "refs/remotes/origin/topic", tip)
        result = self.clean("--gh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("candidate-pr-closed", result.stdout)

    def test_ambiguous_pr_cannot_fall_back_to_stale(self):
        tip = self.unique_commit()
        self.git("update-ref", "refs/remotes/origin/topic", tip)
        for repo, base in (("someone/repo", "canary"), ("example/repo", "main")):
            self.pr("CLOSED", tip, repo=repo, base=base)
            self.assert_retained(self.clean("--apply", "--gh"), "review-pr-ambiguous")
        self.pr("MERGED", tip)
        self.env["PR_ROWS"] *= 2
        self.assert_retained(self.clean("--apply", "--gh"), "review-pr-ambiguous")

    def test_concurrent_changes_during_pr_lookup_abort(self):
        self.env["MUTATE"] = "dirty"
        self.assert_retained(self.clean("--apply", "--gh"), "became dirty")
        (self.worktree / "new-work").unlink()
        self.env["MUTATE"] = "commit"
        self.pr("MERGED", self.base)
        self.assert_retained(self.clean("--apply", "--gh"), "refs changed")

    def test_paused_rebase_protects_detached_branch(self):
        tip = self.unique_commit()
        self.git("update-ref", "refs/remotes/origin/canary", tip)
        self.git("config", "branch.topic.description", "keep configuration")
        self.write_executable("sequence-editor", """#!/usr/bin/env bash
sed 's/^pick /edit /' "$1" > "$1.tmp" && mv "$1.tmp" "$1"
""")
        self.env["GIT_SEQUENCE_EDITOR"] = str(self.bin / "sequence-editor")
        self.git("rebase", "-i", "HEAD~1", cwd=self.worktree)
        self.assertIn("detached", self.git("worktree", "list", "--porcelain"))
        state = Path(self.git("rev-parse", "--git-path", "rebase-merge", cwd=self.worktree).strip())
        self.assertTrue(state.exists())
        self.assert_retained(self.clean("--apply"), "operation in progress")
        self.assertTrue(state.exists())
        self.assertEqual(self.git("config", "branch.topic.description").strip(), "keep configuration")

    def test_paused_bisect_protects_detached_branch(self):
        self.unique_commit()
        tip = self.unique_commit()
        self.git("update-ref", "refs/remotes/origin/canary", tip)
        self.git("bisect", "start", tip, self.base, cwd=self.worktree)
        self.assertIn("detached", self.git("worktree", "list", "--porcelain"))
        state = Path(self.git("rev-parse", "--git-path", "BISECT_START", cwd=self.worktree).strip())
        self.assertTrue(state.exists())
        self.assert_retained(self.clean("--apply"), "operation in progress")
        self.assertTrue(state.exists())

    def test_audit_lists_protected_current_and_merged_candidate(self):
        result = self.run_cleanup("audit")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("protected-branch", result.stdout)
        self.assertIn("candidate-merged", result.stdout)

    def test_locked_config_reports_partial_cleanup(self):
        self.git("config", "branch.topic.remote", "origin")
        (self.repo / ".git/config.lock").write_text("")
        result = self.clean("--apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("configuration cleanup failed", result.stderr)
        self.assertIn("partial cleanup", result.stderr)
        self.assertNotIn("REMOVED-BRANCH", result.stdout)
        self.assertIn("REMOVED-WORKTREE", result.stdout)
        self.assertNotIn("refs/heads/topic", self.git("show-ref"))
        self.assertEqual(self.git("config", "branch.topic.remote").strip(), "origin")

    def test_other_config_exit_128_is_not_ignored(self):
        self.write_executable("git", """#!/usr/bin/env bash
if [[ $1 == config && $2 == --remove-section ]]; then
  echo 'fatal: cannot read configuration' >&2
  exit 128
fi
exec "$REAL_GIT" "$@"
""")
        result = self.clean("--apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("cannot read configuration", result.stderr)
        self.assertIn("partial cleanup", result.stderr)
        self.assertNotIn("REMOVED-BRANCH", result.stdout)

    def test_existing_branch_config_is_removed(self):
        self.git("config", "branch.topic.remote", "origin")
        result = self.clean("--apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("REMOVED-BRANCH", result.stdout)
        self.assertNotIn("branch.topic.", self.git("config", "--local", "--list"))

    def test_failed_branch_delete_does_not_report_success(self):
        self.write_executable("git", """#!/usr/bin/env bash
if [[ $1 == update-ref && $2 == -d ]]; then exit 1; fi
exec "$REAL_GIT" "$@"
""")
        result = self.clean("--apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("partial cleanup", result.stderr)
        self.assertIn("REMOVED-WORKTREE", result.stdout)
        self.assertNotIn("REMOVED-BRANCH", result.stdout)
        self.git("show-ref", "--verify", "refs/heads/topic")


if __name__ == "__main__":
    unittest.main(verbosity=2)
