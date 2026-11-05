# GitHub access

The `gh api` commands this plugin uses. The rules for every call, such as REST only, bodies through a file and when a post counts, are in **GitHub** in `core.md`.

## Issues

| Purpose | Command |
|---|---|
| Read an Issue | `gh api repos/{owner}/{repo}/issues/<n>` |
| Create an Issue | `gh api -X POST repos/{owner}/{repo}/issues -f title='<title>' -F body=@<file> --jq '.number'` |
| Close as won't do | `gh api -X PATCH repos/{owner}/{repo}/issues/<n> -f state=closed -f state_reason=not_planned` |
| Close as a duplicate | `gh api -X PATCH repos/{owner}/{repo}/issues/<n> -f state=closed -f state_reason=duplicate` |

List open Issues, one JSON object per line. Add `&labels=<label>` to the query to list only Issues with that label:

```sh
gh api --paginate 'repos/{owner}/{repo}/issues?state=open&per_page=100' \
  --jq '.[] | select(.pull_request == null) | {number, title, labels: [.labels[].name], author: .user.login, created_at, updated_at}'
```

The issues endpoints also return pull requests. `select(.pull_request == null)` drops them.

Search the repo's Issues, open and closed, pull requests excluded. `-f` URL-encodes the query:

```sh
gh api -X GET search/issues -f q='repo:<owner>/<repo> is:issue <terms>' -f per_page=20 \
  --jq '.items[] | {number, title, state, state_reason, author: .user.login}'
```

`gh api` fills in `{owner}` and `{repo}` only in the endpoint, not in `q`, so write the owner and name from `git remote get-url origin` there. `state_reason` tells an Issue closed as `completed` from one closed as `not_planned` or `duplicate`.

## Labels

| Purpose | Command |
|---|---|
| Labels on one Issue | `gh api repos/{owner}/{repo}/issues/<n>/labels --jq '.[].name'` |
| Add labels | `gh api -X POST repos/{owner}/{repo}/issues/<n>/labels -f 'labels[]=<label>'` (one `-f` per label) |
| Remove a label | `gh api -X DELETE 'repos/{owner}/{repo}/issues/<n>/labels/<label>'` |
| Labels in the repo | `gh api --paginate repos/{owner}/{repo}/labels --jq '.[].name'` |
| Create a label | `gh api -X POST repos/{owner}/{repo}/labels -f name='<label>' -f color='<hex>' -f description='<text>'` |

- Adding a label that does not exist in the repo creates it with a grey color, so recording a `skipped:*` label works before `init` has run.
- A list filtered by label shows a label change only after a few seconds. To read an Issue's labels right after writing them, read that Issue's labels, not a filtered list.
- A label with a colon goes into the path as is: `.../labels/skipped:spec`.

## Comments

| Purpose | Command |
|---|---|
| Comment on an Issue or a PR | `gh api -X POST repos/{owner}/{repo}/issues/<n>/comments -F body=@<file> --jq '.id'` |
| Edit a comment | `gh api -X PATCH repos/{owner}/{repo}/issues/comments/<id> -F body=@<file>` |
| Read a comment | `gh api repos/{owner}/{repo}/issues/comments/<id>` |
| The Issue's pinned comment | `gh api repos/{owner}/{repo}/issues/<n> --jq '.pinned_comment.id // empty'` |
| Pin a comment | `gh api -X PUT repos/{owner}/{repo}/issues/comments/<id>/pin` |

An Issue keeps one pinned comment. Pinning another comment silently unpins the previous one.

## Markers and trust

Skills find their own comments by a hidden HTML marker on the comment's first line:

| Marker | Where | Written by |
|---|---|---|
| `<!-- macro-loop:spec -->` | Issue comment | `spec` |
| `<!-- macro-loop:verify round=N sha=<head> -->` | PR comment | `verify` |
| `<!-- macro-loop:missed pr=<N> -->` | Issue comment on a `missed-by-verify` Issue, naming the merged PR that caused the bug | `triage` |
| `<!-- macro-loop:answer round=N -->` | PR comment | a person, or `implement` after approval |
| `<!-- macro-loop:queue id=<child>.<n> -->` | Comment on a `goal`'s tracking Issue (see **Question queue**) | `grilling` and `spec`, when run unattended |
| `<!-- macro-loop:queue-answer id=<child>.<n> -->` | Comment on a `goal`'s tracking Issue | `goal`, from the person's reply |

An answer records how a finding of round N's verdict was answered. Under the marker, each line is `- <ID> <wrong|intended|minor>: <reason>`, with the finding's ID from the verdict (`AC2`, `F1`, `S1`) and a reason that is never empty:

```text
<!-- macro-loop:answer round=2 -->
- S1 intended: the spec's D2 asks for this retry loop
- F1 wrong: the failing test also fails on the base branch
```

There is no `fixed`: the next round shows that. An answer never changes a verdict. `trust.mjs --pr` lists the trusted answers in `pr.answers`, each with `round`, `id`, `category`, `reason`, `comment` (the comment's id) and `sha` (the head that round's trusted verdict judged, or `null`), and in `pr.answersLine` the verifiers' `Answers` line built from them. The next verdict shows a finding the verifier matched to an answer as already answered; it still counts. A later answer to the same round and ID replaces an earlier one, and a line of any other shape is left out and named in `pr.answerWarnings`.

When a marker counts is in **Trust and trust.mjs** in `core.md`: a comment that quotes a marker further down is not a spec or a verdict.

### Who is trusted

The trusted authors, whose spec and verdict comments count and whose `check: cmd` commands `verify` may run after asking, are:

- **You:** the person running the skill.
- **The `trusted` list** in `.github/macro-loop.json` on the default branch, if the file sets it (see **Configuration** in `workflow.md`).
- **Without a list, the repo's owner,** when the owner is a person rather than an organization.

On an organization's repo without a list, only you are trusted until `init` sets one. Changing the list on the default branch needs push access to the repo, so it can only name people the maintainers chose. A pull request that adds a login to the list changes nothing until it is merged.

Trust is decided by login, never by the author association GitHub attaches to a comment: its `MEMBER` value means any member of the organization, whatever their access to the repo. GitHub logins are not case-sensitive, so they compare in lowercase.

`scripts/trust.mjs` applies this rule, and skills never apply it by hand (see **Trust and trust.mjs** in `core.md`).

### Lookup

`scripts/trust.mjs` finds the spec and the newest verdict (see **Trust and trust.mjs** in `core.md`). Read a comment by its id (see **Comments**).

## Question queue

When the arguments of a skill carry `Unattended: #<t>`, `goal` is running it for a child and nobody can answer. A question that is the person's (a domain rule, a one-way door, a missing access) is written as an item on tracking Issue `<t>` instead of asked. One comment per item, so children can write at the same time:

```text
<!-- macro-loop:queue id=<child>.<n> -->
Child: #<child>
Type: choice | diagnostic | ambiguity | access | approval
Question: <one sentence the person can answer>
Recommended: <the default, and why>
Blocks: <what waits, and what does not>
```

`choice` is a decision between options, `diagnostic` a fact only a person has, `ambiguity` a request that reads two ways, `access` a credential or a permission, `approval` a go-ahead.

To write one: run `scripts/trust.mjs --issue <t>`. `<n>` is the next free number for that child among the ids in `issue.queue`, which lists each trusted item's `id`, `comment`, `child` and `type`; `issue.queueWarnings` names the items it left out. Post the comment (see **Comments**; it counts as posted when the POST printed its id), then hold the child: add `needs-decision` and remove `ready-for-agent` (see **Labels**). The recommended default is not authorized: nothing is built on it until the person answers.

The person's answer is a comment of its own: `<!-- macro-loop:queue-answer id=<child>.<n> -->`, then the reply in the person's words. Never write the recommended default as an answer. Each item in `issue.queue` has `answer`, the id of its newest trusted answer comment, or `null`; an answer with no item, or with another marker shape, is named in `issue.queueWarnings`. A child is held while an item of its own has `answer: null`; once all are answered, put `ready-for-agent` back and remove `needs-decision` (see **Labels**).

## Pull requests

| Purpose | Command |
|---|---|
| Default branch | `gh api repos/{owner}/{repo} --jq .default_branch` |
| Open PR for a branch (the one named, else the current branch) | `gh api 'repos/{owner}/{repo}/pulls?head={owner}:<branch>&state=open' --jq '.[0].number // empty'` |
| Read a PR | `gh api repos/{owner}/{repo}/pulls/<n>` (`.body`, `.base.ref`, `.head.ref`, `.head.sha`, `.html_url`) |
| Create a draft PR | `gh api -X POST repos/{owner}/{repo}/pulls -f title='<title>' -f head='<branch>' -f base='<base>' -F draft=true -F body=@<file> --jq '.html_url'` |
| Edit a PR body | `gh api -X PATCH repos/{owner}/{repo}/pulls/<n> -F body=@<file>` |
| Fetch a PR's head into a local branch, without switching to it | `git fetch origin pull/<n>/head:pr-<n>` |

`open-pr` writes one `Closes #<n>` line per Issue into every PR body it creates. The Issues a PR closes are `pr.closesAll` in the output of `scripts/trust.mjs --pr <n>`; never match the body by hand.
