---
name: iterate-pr
description: Continue working on an existing PR based on user feedback in a new session, with clarifying questions and iterative commits
argument-hint: "[pr-url or pr-number]"
allowed-tools: Bash, Glob, Grep, Read, Write, Edit, Task, AskUserQuestion, TodoWrite
---

# Iterate on PR with User Feedback

You are continuing work on an existing pull request based on user feedback. This skill is designed for situations where:
- The initial implementation was created (e.g., by `/implement-issue`) but ran out of context
- The user has additional requirements or changes they want made
- The work needs to continue in a fresh session

This is **different from `/incorporate-feedback`** which handles code review comments from reviewers. This skill handles direct user instructions like "add infrastructure", "also implement X", or "change the approach to Y".

## Input

The user has provided: $ARGUMENTS

This should be either:
- A GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
- A PR number (e.g., `123`) for the current repository

## Workflow

### Step 1: Fetch PR Context

Get comprehensive information about the existing PR:

```bash
# Get PR metadata
gh pr view <number> --json title,body,state,headRefName,baseRefName,number,commits,files,additions,deletions

# Get the current diff to understand what's already implemented
gh pr diff <number>

# Check for linked issue (look for "Implements #X" in body)
gh pr view <number> --json body --jq '.body'
```

If there's a linked issue, fetch it for context:

```bash
gh issue view <issue-number> --json title,body,comments
```

Summarize for yourself:
- What has already been implemented?
- What was the original goal?
- What files have been changed?

### Step 2: Understand the User's Request

The user will describe what additional work they need. This might be:
- Adding missing functionality ("add the infrastructure changes")
- Extending the implementation ("also handle the edge case where...")
- Changing the approach ("use X instead of Y")
- Completing partial work ("finish implementing the tests")

**Use AskUserQuestion to clarify** if the request is ambiguous:

```
You mentioned adding infrastructure. Let me clarify:

1. Which AWS resources need to be added?
   - SQS queues
   - S3 buckets
   - IAM policies
   - Other (please specify)

2. Should these be added to:
   - api-plane infrastructure
   - build-plane infrastructure
   - Both
```

Keep asking questions until you have a clear understanding of:
- What specific changes are needed
- What files will likely be affected
- What the success criteria are

### Step 3: Explore the Codebase (if needed)

If this is a new session and you don't have context about the codebase:

1. **Review the existing PR changes** to understand what was done
2. **Look at related files** to understand patterns:
   - If adding infrastructure: check `infrastructure/` directory structure
   - If adding deployment scripts: check `scripts/` directory
   - If extending functionality: look at similar implementations

Use the Task tool with `subagent_type=Explore` for broader codebase understanding.

### Step 4: Create Implementation Plan

Based on your understanding, create a clear plan and present it to the user:

```
Based on our discussion, here's what I'll implement:

## Changes Planned

1. **Add SQS queue for async processing**
   - File: `infrastructure/build-plane/remote/main.tf`
   - Add queue resource and IAM permissions

2. **Update deployment script**
   - File: `scripts/deploy.sh`
   - Add new service to deployment order

3. **Add environment variables**
   - Remote: `infrastructure/build-plane/remote/main.tf`
   - Local: Document in PR description

## Files to Create/Modify
- `infrastructure/build-plane/remote/main.tf` (modify)
- `scripts/deploy.sh` (modify)

Does this match your expectations? Should I proceed, or would you like to adjust the plan?
```

Use AskUserQuestion to get explicit confirmation before proceeding.

### Step 5: Checkout and Implement

Ensure you're on the correct branch:

```bash
# Get the branch name
BRANCH=$(gh pr view <number> --json headRefName --jq '.headRefName')

# Checkout the branch
git checkout $BRANCH
git pull origin $BRANCH
```

Use TodoWrite to track your implementation progress:

```
- [ ] Add SQS queue to Terraform
- [ ] Update IAM permissions
- [ ] Modify deployment script
- [ ] Document env vars in PR
```

Work through each item:
1. Mark as in_progress
2. Implement the change
3. Verify it works (run builds, validate terraform, etc.)
4. Mark as completed

### Step 6: Verify and Confirm with User

Before committing, verify your changes and confirm with the user:

```
I've made the following changes:

## Summary
- Added SQS queue `pipeline-events` in build-plane Terraform
- Updated IAM policy with `sqs:SendMessage` permission
- Added deployment step in `scripts/deploy.sh`

## Files Changed
- `infrastructure/build-plane/remote/main.tf` (+45 lines)
- `scripts/deploy.sh` (+3 lines)

## Verification
- [x] Terraform validates successfully
- [x] Deployment script syntax is correct

Would you like me to commit these changes and update the PR?
```

Use AskUserQuestion to get confirmation. The user might:
- Approve and ask you to commit
- Request modifications before committing
- Ask to see specific changes in detail

Handle each case appropriately.

### Step 7: Commit and Update PR

Once confirmed, commit with a clear message:

```bash
git add -A
git commit -m "$(cat <<'EOF'
Add infrastructure and deployment changes

- Add SQS queue for pipeline events
- Update IAM permissions for queue access
- Add deployment step for new queue

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

git push
```

### Step 8: Update PR Description with Revision

Append a revision section to the PR description to track the iteration:

```bash
# Get current PR body
CURRENT_BODY=$(gh pr view <number> --json body --jq '.body')

# Get current revision number (count existing "### Rev" headers)
REV_COUNT=$(echo "$CURRENT_BODY" | grep -c "^### Rev " || echo "0")
NEXT_REV=$((REV_COUNT + 1))

# Get today's date
TODAY=$(date +%Y-%m-%d)

# Update PR with new revision
gh pr edit <number> --body "$(cat <<EOF
$CURRENT_BODY

---

### Rev $NEXT_REV - $TODAY

**User Request:** <brief summary of what the user asked for>

**Changes Made:**
- <change 1>
- <change 2>
- <change 3>

**Files Modified:**
- \`path/to/file1.tf\`
- \`path/to/file2.sh\`
EOF
)"
```

### Step 9: Report to User

Summarize what was done:

1. **Changes committed**: Brief summary
2. **PR updated**: Link to the PR
3. **Revision**: What revision number this is
4. **Next steps**: Ask if there's anything else to iterate on

```
Done! I've pushed the changes and updated PR #123.

**Commit:** "Add infrastructure and deployment changes"
**Revision:** Rev 2 added to PR description

PR: https://github.com/owner/repo/pull/123

Is there anything else you'd like me to adjust, or is this ready for review?
```

## Iteration Loop

This skill is designed for multiple rounds of iteration. After Step 9, the user may:

1. **Request more changes** → Go back to Step 2
2. **Ask clarifying questions** → Answer and continue
3. **Approve the PR** → You're done!

Each iteration should result in:
- A new commit with descriptive message
- A new revision entry in the PR description

## Key Differences from `/incorporate-feedback`

| `/incorporate-feedback` | `/iterate-pr` (this skill) |
|------------------------|---------------------------|
| Handles code review comments | Handles direct user instructions |
| Works from GitHub review comments | Works from conversation with user |
| Responds to reviewer comments on GitHub | Updates PR description with revisions |
| Typically small, focused fixes | Can be larger scope changes |
| Reviewer-driven | User-driven |

## Guidelines

- **Ask questions first**: Don't assume you understand the request. Clarify before implementing.
- **Show your plan**: Always present what you're going to do before doing it.
- **Confirm before committing**: Get explicit user approval before pushing changes.
- **Track revisions**: Keep a clear history in the PR description.
- **Stay focused**: Only implement what the user asked for, don't scope-creep.
- **Verify changes**: Run relevant validation (terraform validate, npm build, etc.) before committing.

## Common Scenarios

### Adding Missing Infrastructure

```
User: "The implementation looks good but you forgot to add the infrastructure"

Response: Let me check what infrastructure is needed based on the implementation...
[Reviews code to understand what AWS resources are used]

Based on the code, I'll need to add:
1. SQS queue for X
2. IAM permissions for Y
3. Environment variables for Z

Does this match what you expected?
```

### Extending Functionality

```
User: "Can you also add support for handling errors?"

Response: I'll need to understand the error handling requirements:

1. What types of errors should be handled?
   - Network failures
   - Validation errors
   - External service errors
   - All of the above

2. How should errors be reported?
   - Log and continue
   - Retry with backoff
   - Alert via SNS
   - Store for later review

[Continue with clarifying questions]
```

### Changing Approach

```
User: "Actually, let's use DynamoDB instead of PostgreSQL for this"

Response: That's a significant change. Let me understand the scope:

1. This will require changes to:
   - Data access layer (new DynamoDB DAO)
   - Infrastructure (DynamoDB table + IAM)
   - Possibly the data model

2. The current implementation has X records in the schema.

Before I proceed, should I:
- Keep backward compatibility with both DBs?
- Fully replace PostgreSQL for this feature?
- Something else?
```