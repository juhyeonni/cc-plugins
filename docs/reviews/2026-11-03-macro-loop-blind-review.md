# macro-loop 블라인드 전문가 리뷰 (2026-11-03)

대상: `plugins/macro-loop`, 커밋 `1d9d616`. 수정은 하지 않았다.

## 요약

단계 판정·신뢰 판정·판정문 작성을 결정적 스크립트로 옮긴 설계는 의도대로 동작한다. 단위 테스트 163/163 통과, 오류 경로는 대부분 fail-closed. 약점은 **판정 스크립트에 들어가는 입력**과 **verifier가 실제로 실행하는 명령**을 아무 코드도 검사하지 않는다는 데 있다. 그래서 "판정은 코드가 쓴다"는 보장이 "모델이 지시를 따른다면"으로 내려간다. 가장 심각한 확정 결함은 execute에서 여러 Issue를 닫는 PR 하나의 NEEDS-FIX가 나중의 PASS에 덮이는 것(N1)이다.

## 방법

1. **블라인드 리뷰**: 전문가 5명(하네스/오케스트레이션, 컨텍스트·프롬프트, LLM eval, 에이전트 보안, Claude Code 런타임·hooks). 각자 받은 것은 정체성, 평가 기준 9개, 증거 규칙뿐. 대상 파일, 주안점, ADR, 작성 의도는 주지 않았다.
2. **반박 검증**: 중복을 합친 주장 목록을 반박 검증자 3명이 나눠 맡아 직접 재현하며 반박을 시도했다. 판정은 CONFIRMED / PLAUSIBLE / REFUTED / DISCLOSED(문서가 이미 인정).
3. **ADR 대조**: 살아남은 발견을 Accepted ADR 15개와 대조했다.

검증 범위: 네트워크와 GitHub 호출 없이, 스크립트와 hook에 조작된 입력을 넣어 재현했다. GitHub이나 Claude Code 런타임 동작에 기대는 부분은 PLAUSIBLE로 남겼다.

## 기준별 점수 (1~5)

| 기준 | 하네스 | 컨텍스트 | eval | 보안 | 런타임 |
|---|---|---|---|---|---|
| 효과성 | 3 | 4 | 3 | 3 | 3 |
| 실제 동작 | 4 | 4 | 4 | 4 | 4 |
| 강제 vs 지시 | 3 | 3 | 3 | 2 | 3 |
| 결정성 | 4 | 4 | 4 | 4 | 4 |
| 실패 처리 | 4 | 4 | 4 | 4 | 3 |
| 신뢰 경계 | 3 | 3 | 3 | 2 | 2 |
| 단순성 | 3 | 3 | 3 | 3 | 3 |
| 비용 | 3 | 3 | 3 | 3 | 3 |
| 검증 가능성 | 3 | 4 | 3 | 3 | 3 |

5명 모두 낮게 본 항목은 "강제 vs 지시"와 "신뢰 경계"이고, 높게 본 항목은 "실제 동작"과 "결정성"이다.

## 확정된 발견 (반박 검증 후 심각도)

### High

**N1. execute에서 여러 Issue를 닫는 PR 하나의 NEEDS-FIX가 나중의 PASS에 덮인다** (CONFIRMED, 코드 연쇄 재현)
- `scripts/execute.mjs` `candidates`는 PR 기준으로 중복을 제거하지 않는다. `Closes #12` / `Closes #13`인 PR #7의 두 Issue가 모두 run에 들어간다(재현: `[12,13]`).
- `workflows/execute-run.js`는 Issue마다 verifier 쌍을 돌리고, 프롬프트에 `Also closes`가 없다.
- `skills/execute/SKILL.md` 4단계는 Issue마다 verdict를 따로 게시한다.
- `scripts/trust.mjs`는 **마지막** verdict의 결과만 읽는다. 그래서 #12 NEEDS-FIX → #13 PASS 순서로 게시되면 `stageOf`가 두 Issue 모두를 `merge`로 판정한다(재현: `{"stage":"merge"}`). round도 한 번에 2씩 오른다.
- verify 스킬은 같은 경우를 verdict 하나로 묶는다(`verdict.mjs` byIssue). execute만 다르게 처리한다.
- ADR: ADR-0015("verify와 execute는 그 출력을 그대로 게시")가 전제하는 판정 단위가 execute에서 깨진다.

### Medium

**A1. spec 리포트의 `criteria: []`가 "This PR can merge" PASS가 된다** (CONFIRMED, 5명 모두 독립적으로 발견)
- `scripts/verdict.mjs` validate는 배열인지만 확인한다.
- 정상 흐름에서도 도달한다. `skipped:spec`으로 진행하면 Issue 본문을 기준으로 판정하는데, init 템플릿(`bug.yml`, `feature.yml`)에는 AC 칸이 없어서 정직한 verifier도 `criteria: []`를 낼 수 있다.
- ADR: ADR-0014의 "PASS stays possible when nothing ran"은 기준이 있되 읽기만으로 판정한 경우다. 기준이 0개인 경우는 어떤 ADR도 다루지 않는다. ADR-0015의 "cannot read its input fails closed" 취지와도 어긋난다.

**A2. manual 기준이 manualChecks에서 빠져도 "No manual checks" PASS가 된다** (CONFIRMED)
- `result:"manual"` + `manualChecks:[]`이면 PASS가 나오고 수동 확인 안내가 없다.
- `result:"manual"` + `judged:"ran"` 조합도 받아서 "ran"으로 센다.
- AC ID 중복을 허용하고, spec 본문의 AC 목록과 대조하지 않는다.
- 모델이 빠뜨리는 것만으로 사람이 수동 확인 없이 merge하게 된다.

**A3. 리포트가 head·Issue·closesAll에 묶여 있지 않다** (CONFIRMED 코드 / PLAUSIBLE 도달)
- 리포트 스키마에 head가 없다. `--agent <old id>`로 넘긴 이전 리포트가 새 sha의 PASS로 쓰인다.
- `issue:99` 리포트도 받는다.
- 여러 Issue를 닫는 PR에서 일부 Issue의 리포트만 넘겨도 PASS가 된다.
- 저장된 리포트(`~/.claude/macro-loop-reports`)는 정리되지 않는다(E7).

**A4. execute는 세션이 리포트를 파일로 옮겨 쓴다** (CONFIRMED)
- `skills/execute/SKILL.md:53` "write the run's spec and standards reports … each to its own file"
- 반면 ADR-0015는 "so the session never copies a report (#176)"이라고 쓴다. **Accepted ADR과 직접 모순된다.** `verdict.mjs`가 positional 파일을 받는 경로가 이 모순을 가능하게 한다.
- 완화 요인: execute에서 코드를 쓴 것은 workflow 하위 agent이고 메인 세션이 아니다.

**A6. verdict 게시 단계를 검사하는 장치가 없다** (CONFIRMED, 부분 DISCLOSED)
- 신뢰된 로그인이 쓴, 마커로 시작하는 코멘트는 무엇이든 verdict로 센다(`trust.mjs:85-86`).
- README:67은 "verdict는 코드가 결정"이라고 쓰지만, 게시 단계까지 강제한다고 주장하지는 않는다. 다만 독자에게는 실제보다 강한 보장으로 읽힌다.

**B1. verifier worktree hook을 `cd`나 `git -C`로 우회한다** (CONFIRMED, 5명 모두 발견)
- `scripts/verifier-worktree.mjs`는 hook 입력의 `cwd`만 보고 명령 내용은 보지 않는다. 다음 명령이 그대로 허용된다.
  - `cd /repo && npm test`
  - `git -C /repo checkout main`
- README의 "never in your checkout"은 단정적으로 쓰여 있다. ADR-0007이 막으려던 사고(`git checkout -- .`)가 이 경로로 다시 가능하다.
- 정상 흐름에서는 주입되었거나 오작동하는 verifier만 여기에 도달하고, 남는 방어선은 permission prompt뿐이다.

**B2. verifier의 `gh api` 쓰기를 막지 않는다** (PLAUSIBLE, 부분 DISCLOSED)
- 프롬프트 인젝션에 걸린 verifier가 사용자 로그인으로 `<!-- macro-loop:verify … -->` PASS 코멘트를 게시할 수 있다. 그 코멘트는 trusted로 집계된다.
- verifier는 매번 `gh api`로 읽기를 하므로, 사용자가 `gh api`를 allowlist에 넣을 유인이 크다. 그러면 permission prompt라는 방어선도 사라진다.
- `-f`가 있으면 `gh api`의 기본 메서드는 POST다. 그래서 `-X POST` 패턴만 막아서는 부족하다.

**E1. README의 "NEEDS-FIX is reported, never fixed automatically"와 `next`의 동작이 반대다** (CONFIRMED)
- `stage.mjs:31`은 current NEEDS-FIX를 `implement`(gate=false)로 판정하고, `next`는 이때 implement를 호출한다.
- 그래서 `next`는 사람 확인 없이 재수정을 시작한다. 루프는 cap(3)과 next의 8라운드 상한에서 멈춘다.

**E4. workflow verifier에 hook이 걸리는지 오프라인 검증이 없다** (PLAUSIBLE)
- workflow의 `agent()`에 PreToolUse/SubagentStop hook이 적용된다는 것은 런타임 동작이고, 오프라인 테스트로 확인되지 않는다. 적용되지 않는다면 execute 경로에서는 식별자·worktree·정리 hook이 모두 빠진다.
- `Also closes` 누락은 N1에 포함했다.

### Low

| ID | 내용 | 비고 |
|---|---|---|
| A5 | `--round 7`이 "round 7 of 3"으로 표기됨 | "--round 1 반복으로 cap 회피"는 **REFUTED**: cap은 verdict 개수로 센다 |
| B3 | `.claude/worktrees/wf_*-N`이면 어느 경로든 자기 worktree로 인정 | Bash cwd는 호출마다 리셋되어 실제 도달은 어려움 |
| B4 | standards 축의 "runs nothing"과 untrusted 작성자 동의는 지시뿐 | hooks.json이 "일관성"만 약속함(DISCLOSED). execute는 untrusted PR을 미리 제외 |
| C1 | `Base: \S+`로 공백 없는 메모를 밀반입할 수 있고, 필수 줄이 빠져도 허용 | ADR-0004의 취지가 형식 검사로만 강제됨 |
| C2 | `Spec comment:` id 값을 검증하지 않음 | 정상 흐름에서는 trust.mjs가 id를 줌. A3과 결합하면 커짐 |
| C3 | 식별자 줄이 중복되면 untrusted rewrite 뒤에도 `yes`가 남음 | 의도적으로 만들어야 하고, 증분 위험이 작음 |
| C4 | head에서 열린 PR이 0건이면 untrusted 검사를 건너뜀 | fork에서 그런지는 GitHub 동작에 달림 |
| C5 | hook crash(exit 1)는 non-blocking | 정상 실패는 deny로 처리됨. 사실상 도달 불가 |
| C6 | `subagent_type`이 다르면 hook이 전부 무력 | 그 자체는 fail-closed. A4와 결합할 때만 위험 |
| 추가 | untrusted 검사는 두 실행 플래그 값이 다를 때만 돌고, standards 축에는 아예 걸리지 않음 | 설계대로의 동작. README의 "Enforced" 표현을 정정할 것 |
| D1 | `findPr`가 작성자 신뢰를 보지 않음 → `<n>-*` 브랜치의 untrusted PR이 선택을 가로챔(execute DoS). `Closes`가 코드펜스·HTML 주석 안에서도 매칭 | "판정 위조나 코드 실행으로 이어진다"는 부분은 REFUTED |
| D2 | sha 없는 verdict는 모든 head에서 current | 의도된 마이그레이션(코드 주석에 명시). 정상 흐름에서 생성되지 않음 |
| D3 | 7자 sha verdict는 `===` 비교로 영원히 not-current | Head는 보통 40자라서 드묾 |
| D4 | write 권한자가 남의 trusted 코멘트를 편집해도 작성자가 유지됨 | PLAUSIBLE. 문서에 언급 없음 |
| D5 | trust가 PR 작성자 기준이라 커밋 작성자는 보지 않음 | ADR-0002의 귀결 |
| E3 | budget 테스트가 implement→open-pr→verify 연쇄(약 37.5k자)와 core.md가 가리키는 github.md·workflow.md(약 12k자)를 세지 않음 | |
| E5 | 시나리오 스위트가 `gh api`, `npm test`, `node`를 allow → permission prompt 방어선은 검증되지 않음 | canary 검사는 오히려 더 엄격함 |
| E7 | 리포트 디렉터리가 정리되지 않음 | |
| E8 | `specCommands` 정규식이 놓치는 `check: cmd`를 verifier는 실행할 수 있음. 승인은 Issue 단위 불리언 | spec이 trusted라서 위협이 낮음 |
| 추가 | `Fixes`/`Resolves #n`을 인식하지 않고, 기본 브랜치가 아닌 base의 PR은 무시함 | open-pr는 항상 `Closes`를 씀 |

### None / DISCLOSED
- E2: execute가 cap을 산문으로 재판정함. stage.mjs가 이미 stop을 주므로 죽은 지시다. 정리 대상.
- E6: 판정 정확도가 통과 기준이 아니고 시드가 얇음. `tests/macro-loop/README.md`가 이미 인정한다.

## 잘 된 점 (리뷰어 다수가 같은 것을 꼽음)
- trust, verdict, verifier-flags가 fail-closed다. gh 실패, 블록 누락, `couldNotRun`이 있으면 아무것도 게시하지 않는다.
- config를 기본 브랜치의 contents API로만 읽는다(ADR-0010). PR이 자기를 trusted에 넣는 공격을 구조적으로 막는다.
- 판정의 첫 화면이 산문이 아니라 data block에서 나온다. 마지막 블록만 읽으므로 인용된 가짜 블록에 속지 않는다.
- 식별자가 아닌 줄을 지우지 않고 거부한다. 메모가 붙었다는 흔적이 남는다.
- README의 "Enforced, or followed" 절이 무엇이 강제이고 무엇이 지시인지 정직하게 구분한다.

## ADR 대조

| ADR | 관련 발견 | 판단 |
|---|---|---|
| 0015 verdict는 스크립트가 쓴다 | A4, N1, A1, A3 | **A4는 ADR 본문과 직접 모순**이다. "session never copies a report"를 execute가 어긴다. execute를 `--agent` 경로로 합치거나, ADR에 예외를 명시해야 한다 |
| 0014 base에서 실패해야 인정 | A1 | 기준이 0개인 경우가 정의되지 않았다. 허용할지 INCONCLUSIVE로 처리할지 결정이 필요하다 |
| 0005 누락 입력은 경고만 | A1 | `skipped:spec`으로 진행하면 기준 없는 PASS로 이어진다. 0014와 함께 결정할 것 |
| 0004 identifiers only | B1, C1, C2 | 줄 형식만 강제되고, 값과 실행 위치는 지시에 머문다. ADR 자체에 도전하는 발견은 아니고 구현이 부족한 것이다 |
| 0007 이른 단계는 working tree 불변 | B1 | ADR이 막으려던 `git checkout` 사고가 verifier에서 `git -C`로 가능하다 |
| 0002 로그인으로 신뢰 / 0003 마커+작성자 | D4, D5, B2 | 로그인 기준 신뢰의 귀결이다. 트레이드오프로 남기되 README에 한계를 적을 것. B2는 이 규칙 때문에 verifier가 게시한 코멘트도 trusted가 된다 |

## 수정 우선순위 (최소 변경 제안, 미적용)

1. **N1**: execute에서 같은 PR을 닫는 Issue들을 PR 하나로 묶어, verify처럼 verdict 하나로 게시한다.
2. **A1, A2**: `verdict.mjs` validate에서 다음을 처리한다.
   - spec 축의 `criteria.length === 0`을 INCONCLUSIVE로 보낸다. 허용하기로 결정한다면 그 결정을 ADR로 남긴다.
   - `result:"manual"` ⇔ `judged:"manual"` 조합과 manualChecks 포함을 강제한다.
   - AC ID 중복을 거부한다.
3. **A3**: 리포트 블록에 `head`를 필수로 넣고 `--head`와 같은지 확인한다. `verdict.mjs`가 `--pr`을 받아 closesAll 전체가 커버됐는지 검사한다.
4. **B1, B2**: `verifier-worktree.mjs`가 명령 내용도 검사해서 다음을 거부한다.
   - `cd`, `pushd`, `git -C`, `--git-dir`, `--work-tree`
   - `gh api`의 쓰기 호출: GET이 아닌 `-X`/`--method`, 또는 `-f`/`-F`/`--field`/`--input`
   - `git push`, `git commit`
5. **A4**: workflow가 verifier agent id를 반환하게 해서 경로를 `--agent` 하나로 합치고, positional 파일 입력을 없앤다.
6. **E1**: README 문장을 실제 동작에 맞춘다. 반대로 자동 수정 금지가 의도라면 stage.mjs에서 `gate=true`로 바꾼다.
