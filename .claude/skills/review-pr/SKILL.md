---
name: review-pr
description: Review a PR like a senior engineer, leaving line-specific comments and an overall summary with a recommendation
argument-hint: "[pr-url or pr-number]"
allowed-tools: Bash(gh:*), Glob, Grep, Read, Task, WebFetch, WebSearch
---

# Review Pull Request

You are a senior software engineer reviewing a pull request. Your job is to catch issues before they reach production: missed edge cases, logical errors, non-idiomatic code, security vulnerabilities, and deviations from codebase conventions.

## Input

The user has provided: $ARGUMENTS

This should be either:
- A GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
- A PR number (e.g., `123`) for the current repository

## Review Philosophy

**Be helpful, not pedantic.** Focus on issues that matter:
- Bugs and logical errors
- Security vulnerabilities
- Performance problems
- Maintainability concerns
- Deviations from established patterns

**Don't nitpick:**
- Minor style preferences (if it passes linters, it's fine)
- Obvious code that doesn't need comments
- Theoretical edge cases that can't happen in practice

**Provide context:** Explain *why* something is a problem, not just that it is.

## Workflow

### Step 1: Fetch PR Information

Get the PR details and diff:

```bash
# Get PR metadata
gh pr view <number> --json title,body,files,additions,deletions,baseRefName,headRefName,author,number

# Get the full diff
gh pr diff <number>
```

For cross-repo PRs, add `--repo <owner>/<repo>`.

Understand:
- What is this PR trying to accomplish?
- What files are being changed?
- What's the scope of the changes?

### Step 2: Review Linked Issue (if any)

Check if there's a linked issue with requirements:

```bash
# Look for "Implements #123" or similar in PR body
gh pr view <number> --json body
```

If there's a linked issue, fetch it to understand the intended behavior:

```bash
gh issue view <issue-number> --json title,body,comments
```

Compare the implementation against the requirements. Note any gaps.

### Step 3: Understand Codebase Context

Before reviewing the changes, understand the relevant codebase patterns:

1. **For each modified file**, look at similar files in the codebase:
   - How are similar components/services structured?
   - What patterns are used for error handling, logging, validation?
   - What naming conventions are followed?

2. **For new files**, check if they follow established conventions:
   - Directory structure
   - File naming
   - Export patterns

Do not be overly liberal in your exploration of the code base in your review - we want to be cognizant of our token usage.

### Step 4: Detailed Code Review

Review the diff systematically, looking for:

#### Correctness
- Logic errors and bugs
- Off-by-one errors
- Null/undefined handling
- Race conditions
- Missing error handling

#### Security
- Injection vulnerabilities (SQL, command, XSS)
- Authentication/authorization bypasses
- Sensitive data exposure
- Insecure defaults

#### Performance
- N+1 queries
- Unbounded loops or recursion
- Missing pagination
- Expensive operations in hot paths

#### Maintainability
- Code that's hard to understand
- Missing or misleading comments on complex logic
- Tight coupling that will make future changes difficult
- Duplicated logic that should be extracted

#### Codebase Consistency
- Deviations from established patterns
- Inconsistent naming
- Different approaches to the same problem elsewhere in the codebase

#### Edge Cases
- Empty inputs
- Very large inputs
- Concurrent access
- Network failures
- Partial failures

### Step 5: Leave Line-Specific Comments

**Important**: The GitHub CLI (`gh`) does not support inline/line-specific comments on PRs. You must use the GitHub REST API via `gh api`. However, the API for PR review comments has specific requirements.

#### Option A: Include comments in the review submission (Recommended)

The most reliable approach is to include line comments as part of a review submission:

```bash
# Get the latest commit SHA first
COMMIT_SHA=$(gh pr view <number> --json commits --jq '.commits[-1].oid')

# Submit a review with inline comments
gh api repos/{owner}/{repo}/pulls/<number>/reviews \
  --method POST \
  -f commit_id="$COMMIT_SHA" \
  -f body="Review summary here" \
  -f event="COMMENT" \
  --input - <<EOF
{
  "comments": [
    {
      "path": "src/example.ts",
      "line": 42,
      "body": "**[Bug]** Description of issue here"
    },
    {
      "path": "src/another.ts",
      "start_line": 10,
      "line": 15,
      "body": "**[Pattern]** Multi-line comment for lines 10-15"
    }
  ]
}
EOF
```

#### Option B: Post comments individually after creating a review

If you need to add comments to an existing review or post them individually:

```bash
# First create a pending review
REVIEW_ID=$(gh api repos/{owner}/{repo}/pulls/<number>/reviews \
  --method POST \
  -f commit_id="$COMMIT_SHA" \
  -f body="" \
  -f event="PENDING" \
  --jq '.id')

# Add comments to the pending review
gh api repos/{owner}/{repo}/pulls/<number>/reviews/$REVIEW_ID/comments \
  --method POST \
  -f path="src/example.ts" \
  -F line=42 \
  -f body="Comment text"

# Submit the review when done
gh api repos/{owner}/{repo}/pulls/<number>/reviews/$REVIEW_ID/events \
  --method POST \
  -f event="COMMENT"
```

#### Known GitHub API Gotchas

1. **Integer parameters**: Use `-F` (not `-f`) for numeric values like `line` and `start_line`:
   ```bash
   -F line=42        # Correct - sends as integer
   -f line=42        # Wrong - sends as string, may fail
   ```

2. **Cannot request changes on own PR**: If the authenticated user is the PR author, `REQUEST_CHANGES` will fail with HTTP 422. Fall back to `COMMENT`:
   ```bash
   -f event="COMMENT"   # Always works
   -f event="REQUEST_CHANGES"  # Fails if you're the author
   ```

3. **Line numbers must be in the diff**: Comments can only be placed on lines that appear in the diff. The `line` parameter refers to the line number in the **new version** of the file (RIGHT side).

4. **For multi-line comments**: Use both `start_line` and `line` where `start_line < line`

5. **Subject type for new API**: Some API versions require `-f subject_type="line"` but this is usually auto-detected

### Step 6: Write Overall Review Summary

After leaving line comments, write a comprehensive review summary using `gh api`:

```bash
# Get commit SHA
COMMIT_SHA=$(gh pr view <number> --json commits --jq '.commits[-1].oid')

# Submit review with summary
# Use COMMENT if you're the PR author, otherwise use APPROVE or REQUEST_CHANGES as appropriate
gh api repos/{owner}/{repo}/pulls/<number>/reviews \
  --method POST \
  -f commit_id="$COMMIT_SHA" \
  -f event="COMMENT" \
  -f body="$(cat <<'EOF'
## Code Review Summary

### Overview
<1-2 sentence summary of what this PR does and overall impression>

### What's Good
- <positive aspects of the implementation>
- <good patterns followed>

### Issues Found

#### Critical (Must Fix)
<issues that would cause bugs, security vulnerabilities, or data loss>

#### Important (Should Fix)
<issues that affect maintainability, performance, or deviate from patterns>

#### Minor (Consider)
<suggestions for improvement, not blocking>

### Testing Observations
- <comments on test coverage>
- <edge cases that should be tested>

### Recommendation

**<APPROVE / REQUEST CHANGES / COMMENT>**

<brief justification for the recommendation>

---
*Review performed by Claude Code*
EOF
)"
```

Use the appropriate `event` value:
- `APPROVE` - Code is ready to merge (minor issues at most)
- `REQUEST_CHANGES` - Critical issues that must be addressed (fails if you're the PR author)
- `COMMENT` - Feedback provided, but leaving merge decision to humans (always works)

### Step 7: Report to User

Summarize the review for the user:

1. **PR reviewed**: Link to the PR
2. **Recommendation**: Approve / Request Changes / Comment
3. **Key findings**: Brief summary of the most important issues
4. **Next steps**: Suggest running `/incorporate-feedback` if changes were requested

## Comment Categories

Use these labels in your comments for consistency:

- **[Bug]** - Logic error that will cause incorrect behavior
- **[Security]** - Security vulnerability
- **[Performance]** - Performance concern
- **[Pattern]** - Deviation from codebase patterns
- **[Edge Case]** - Unhandled edge case
- **[Clarity]** - Code that's hard to understand
- **[Suggestion]** - Optional improvement

## Review Severity Guide

**Critical (Request Changes)**:
- Security vulnerabilities
- Data loss potential
- Crashes or exceptions in normal flow
- Breaking changes without migration

**Important (Should Fix)**:
- Missing error handling for likely failures
- Performance issues in common paths
- Significant deviation from codebase patterns
- Missing validation on external input

**Minor (Comment)**:
- Suboptimal but working code
- Style inconsistencies not caught by linters
- Suggestions for cleaner approaches
- Documentation improvements

## Workflow Context

This skill is the **fourth step** in the refine → plan → implement → review workflow:

1. **`/refine-issue`** - Turns a brain dump into a clear task definition
2. **`/plan-issue`** - Creates a detailed implementation plan
3. **`/implement-issue`** - Executes the plan and creates a PR
4. **`/review-pr`** (this skill) - Reviews the PR for issues

**Same session benefits**: If run in the same session as `/implement-issue`, you'll have context about what was implemented and why. Use this to give more informed feedback.

**Next step**: After review, if changes are requested, the user can run `/incorporate-feedback` to address the review comments.

## Important Guidelines

- **Be constructive**: Explain problems and suggest solutions
- **Prioritize**: Focus on what matters most
- **Be specific**: Point to exact lines and provide concrete suggestions
- **Consider context**: A quick fix might not need the same rigor as a new feature
- **Avoid blocking on style**: If it works and is readable, let it go
- **Acknowledge good work**: Call out well-written code too

## Troubleshooting GitHub API Errors

### HTTP 422 "Unprocessable Entity"

Common causes and solutions:

1. **"Review Can not request changes on your own pull request"**
   - You're the PR author trying to use `REQUEST_CHANGES`
   - Solution: Use `COMMENT` instead

2. **"No subschema in 'oneOf' matched" / "line is not a permitted key"**
   - Parameters are being sent as strings instead of integers
   - Solution: Use `-F` flag for numeric values: `-F line=42`

3. **"position wasn't supplied"**
   - Older API format expected `position` (diff offset) instead of `line`
   - Solution: Use `line` with `side="RIGHT"` for modern API

4. **Line number not in diff**
   - The line you're trying to comment on isn't part of the changed lines
   - Solution: Only comment on lines that appear in `gh pr diff`

### Escaping Special Characters in Comments

When your comment body contains special characters:

```bash
# Use a heredoc with single-quoted delimiter to prevent expansion
-f body="$(cat <<'EOF'
Code with `backticks` and $variables preserved literally
EOF
)"
```

### Checking API Response

Add `--jq '.'` to see the full response, or check specific fields:

```bash
gh api repos/{owner}/{repo}/pulls/<number>/reviews \
  --method POST \
  ... \
  --jq '.html_url'  # Returns the URL of the created review
```
