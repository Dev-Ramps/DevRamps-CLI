---
name: incorporate-feedback
description: Review PR feedback comments, ask the user which to address, and implement the selected fixes
argument-hint: "[pr-url or pr-number]"
allowed-tools: Bash, Glob, Grep, Read, Write, Edit, Task, AskUserQuestion, TodoWrite
---

# Incorporate PR Feedback

You are helping the user address feedback left on a pull request. Your job is to gather all feedback, let the user decide which items to address, and then implement the selected fixes.

## Input

The user has provided: $ARGUMENTS

This should be either:
- A GitHub PR URL (e.g., `https://github.com/owner/repo/pull/123`)
- A PR number (e.g., `123`) for the current repository

## Workflow

### Step 1: Fetch PR and All Comments

Get the PR details and all review comments:

```bash
# Get PR metadata
gh pr view <number> --json title,body,state,headRefName,number

# Get all review comments (line-specific comments)
gh api repos/{owner}/{repo}/pulls/<number>/comments --paginate

# Get all issue-style comments (general discussion)
gh pr view <number> --json comments --jq '.comments'

# Get review summaries
gh api repos/{owner}/{repo}/pulls/<number>/reviews --paginate
```

For cross-repo PRs, adjust the owner/repo accordingly.

### Step 2: Parse and Categorize Feedback

Extract all distinct feedback items from:
1. **Line-specific review comments** - Comments on specific code lines
2. **Review summaries** - Overall feedback from reviewers
3. **Conversation comments** - General discussion on the PR

For each feedback item, capture:
- **Source**: Who left it and where (line comment, review summary, etc.)
- **Location**: File and line number (if applicable)
- **Content**: The actual feedback
- **Category**: Bug, Security, Performance, Pattern, etc. (if labeled)
- **Severity**: Critical, Important, Minor (infer from context)

Group related comments together (e.g., multiple comments about the same issue).

### Step 3: Present Feedback to User

Present each distinct feedback item to the user for decision. Use AskUserQuestion to batch related decisions:

For example, if there are 6 feedback items, present them in groups:

```
I found 6 feedback items on PR #123. Let me walk through them:

**1. [Bug] Null check missing in user validation**
File: `src/services/user-service.ts:45`
Comment: "This will throw if user is undefined. Need to add a null check."

**2. [Pattern] Inconsistent error handling**
File: `src/controllers/auth-controller.ts:78-82`
Comment: "Other controllers use the ErrorHandler utility. This should too for consistency."

**3. [Suggestion] Consider extracting magic number**
File: `src/utils/rate-limiter.ts:23`
Comment: "The 100 here should probably be a named constant."

...
```

Then ask which to address:

```
Which of these feedback items would you like me to address?
```

Options:
- "All of them" - Address every item
- "Critical/Important only" - Skip minor suggestions
- "Let me choose" - Ask about each one individually

If "Let me choose", iterate through each item:
```
Address item #1 (Null check missing)?
- Yes
- No
- Modify (explain what you want instead)
```

### Step 4: Create Implementation Checklist

Based on the user's selections, create a todo list of fixes to implement:

```
Selected fixes:
- [ ] Fix null check in user-service.ts:45
- [ ] Update error handling in auth-controller.ts to use ErrorHandler
- [ ] Extract rate limit constant in rate-limiter.ts
```

Use the TodoWrite tool to track progress.

### Step 5: Checkout the PR Branch

Ensure you're on the correct branch:

```bash
# Get the branch name
BRANCH=$(gh pr view <number> --json headRefName --jq '.headRefName')

# Checkout the branch
git checkout $BRANCH
git pull origin $BRANCH
```

### Step 6: Implement Each Fix

Work through each selected fix:

1. **Mark as in_progress** in the todo list
2. **Read the relevant code** to understand the context
3. **Implement the fix** following the feedback's suggestion
4. **Verify the fix** addresses the concern
5. **Mark as completed**

**Implementation guidelines:**
- Follow the suggestion if it's specific and correct
- If the suggestion seems wrong, note it and implement what's actually correct
- Keep fixes minimal and focused—don't refactor unrelated code
- Maintain consistency with surrounding code

### Step 7: Respond to Comments

After fixing each item, resolve or reply to the comment:

**For line comments that are fully addressed:**
```bash
# Reply to the comment indicating it's fixed
gh api repos/{owner}/{repo}/pulls/<number>/comments/<comment-id>/replies \
  --method POST \
  -f body="Fixed in the upcoming commit. <brief description of fix>"
```

**For comments that were intentionally not addressed:**
```bash
gh api repos/{owner}/{repo}/pulls/<number>/comments/<comment-id>/replies \
  --method POST \
  -f body="Decided not to address: <reason>"
```

**For comments where you took a different approach:**
```bash
gh api repos/{owner}/{repo}/pulls/<number>/comments/<comment-id>/replies \
  --method POST \
  -f body="Addressed differently: <explanation of what you did instead and why>"
```

### Step 8: Commit and Push

Once all selected fixes are implemented:

```bash
git add -A
git commit -m "$(cat <<'EOF'
Address PR feedback

- <fix 1 description>
- <fix 2 description>
- <fix 3 description>

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

git push
```

### Step 9: Update PR with Summary

Add a comment to the PR summarizing what was addressed:

```bash
gh pr comment <number> --body "$(cat <<'EOF'
## Feedback Addressed

I've addressed the following feedback items:

### Fixed
- **Null check missing** (`user-service.ts:45`) - Added null check with early return
- **Inconsistent error handling** (`auth-controller.ts`) - Switched to ErrorHandler utility

### Intentionally Not Addressed
- **Extract magic number** - Left as-is since it's only used in one place and the context is clear

### Different Approach Taken
- <if any>

---
*Feedback incorporated by Claude Code*
EOF
)"
```

### Step 10: Report to User

Summarize what was done:

1. **Fixes implemented**: List of changes made
2. **Items skipped**: What wasn't addressed and why
3. **Commit created**: Link to the commit
4. **Next steps**: Suggest re-running `/review-pr` if significant changes were made

## Handling Complex Feedback

### When feedback is unclear
Ask the user for clarification before implementing:
```
The feedback on line 45 says "this could be better" but doesn't specify how.
What would you like me to do here?
```

### When feedback conflicts with other feedback
Present both to the user:
```
There's conflicting feedback:
- Reviewer A says: "Use async/await here"
- Reviewer B says: "Keep the promise chain for consistency with nearby code"

Which approach would you prefer?
```

### When feedback requires significant refactoring
Warn the user about scope:
```
This feedback suggests restructuring the entire service layer.
This would be a significant change (~200 lines affected).

Options:
- Do the full refactor
- Do a minimal fix that addresses the immediate concern
- Skip this and address in a separate PR
```

### When you disagree with the feedback
Note your concern but defer to the user:
```
The reviewer suggests removing this error handling, but I believe it's needed
because <reason>.

Would you like me to:
- Follow the reviewer's suggestion anyway
- Keep the current code and reply explaining why
- Modify it differently (please specify)
```

## Important Guidelines

- **Respect user decisions**: Don't push back if they choose not to address something
- **Keep fixes focused**: Only change what's needed to address the feedback
- **Maintain context**: Reply to comments so reviewers know their feedback was seen
- **Be transparent**: If you can't or shouldn't fix something, explain why
- **Track everything**: Use the todo list to ensure nothing is missed
- **Test changes**: Verify fixes don't break existing functionality
