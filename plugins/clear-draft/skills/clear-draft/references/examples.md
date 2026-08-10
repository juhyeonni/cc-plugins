# 실제 모범 사례와 Before / After 예문

1부는 **실제 발표된 논문 원문**(수정 없음), 2부는 그 원칙을 적용한 교정 예문이다.

---

# 1부. 실제 논문 원문

## 1-1. Watson & Crick (1953) — 결론 우선의 교과서

> "WE wish to suggest a structure for the salt of deoxyribose nucleic acid (D.N.A.). This structure has novel features which are of considerable biological interest."

> "It has not escaped our notice that the specific pairing we have postulated immediately suggests a possible copying mechanism for the genetic material."

*Nature* 171(4356), 737–738 (1953).

**배울 점**
- 첫 문장이 곧 논문 전체다. 배경 설명이 한 줄도 앞에 없다.
- 주장의 강도를 정확히 조절했다. `suggest`, `possible` — 근거가 딱 거기까지였기 때문이다. 남용된 hedge가 아니라 **정확한 hedge**다.
- 가장 큰 함의를 **문장 끝(강조 위치)** 에 놓았다 (Gopen & Swan 원칙 2).

---

## 1-2. Vaswani et al. (2017), "Attention Is All You Need" — 초록 전문

> "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks in an encoder-decoder configuration. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train. Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task, improving over the existing best results, including ensembles by over 2 BLEU. …"

arXiv:1706.03762.

**배울 점**
- 문장 1–2 = 기존 방식(old information) → 문장 3 = 우리 것(new information). Gopen & Swan의 old-to-new 흐름 그대로다.
- 3번째 문장 하나에 **무엇을(the Transformer) / 무엇에 근거해(attention only) / 무엇을 버렸는지(recurrence, convolutions)** 가 다 들어 있다.
- 능동태 + `We propose`. 주어를 숨기지 않는다.
- 주장 뒤에 즉시 숫자(28.4 BLEU)가 온다. 근거 없는 형용사가 없다.

---

## 1-3. Polack et al. (2020), NEJM — 구조화 초록의 표준

> **Background** … Safe and effective vaccines are needed urgently.
> **Methods** In an ongoing multinational, placebo-controlled, observer-blinded, pivotal efficacy trial, we randomly assigned persons 16 years of age or older in a 1:1 ratio to receive two doses, 21 days apart, of either placebo or the BNT162b2 vaccine candidate (30 μg per dose). …
> **Results** A total of 43,548 participants underwent randomization … BNT162b2 was 95% effective in preventing Covid-19 (95% credible interval, 90.3 to 97.6). …
> **Conclusions** A two-dose regimen of BNT162b2 conferred 95% protection against Covid-19 in persons 16 years of age or older. …

*N Engl J Med* 383(27), 2603–2615 (2020).

**배울 점**
- Methods의 수식어 나열(`multinational, placebo-controlled, observer-blinded, pivotal`)이 길지만 **모두 판단에 필요한 정보**다. 장식은 하나도 없다.
- 모든 수치에 불확실성 구간이 붙는다. hedge를 말이 아니라 **숫자로** 표현했다.
- Conclusions가 Results를 넘어서지 않는다. 관찰 기간(median 2 months)까지 그대로 밝힌다.

---

## 1-4. Shannon (1948) — 문제 정의의 정석

> "The fundamental problem of communication is that of reproducing at one point either exactly or approximately a message selected at another point. Frequently the messages have meaning; that is they refer to or are correlated according to some system with certain physical or conceptual entities. **These semantic aspects of communication are irrelevant to the engineering problem.** The significant aspect is that the actual message is one selected from a set of possible messages."

*Bell System Technical Journal* 27 (1948).

**배울 점**
- **범위 밖(non-goal)을 한 문장으로 못 박았다.** 이 한 줄이 이후 논의가 새는 것을 전부 막는다. GH 이슈·설계 문서의 "범위 밖" 항목이 하는 일과 같다.
- 그 다음 문장이 즉시 "그럼 중요한 건 뭔가"로 이어진다. 버리기만 하지 않는다.

---

## 1-5. 일본어 — 主題文을 첫 문장에 두는 형

> 本研究の目的は，高校の情報科と生物科を横断した探究型授業を対象として，課題の設定を支援することで学際的思考の育成を目指した教育実践の開発と評価をすることである．具体的には，生徒の研究スキル，学際的思考，および探究に対する認識はどの程度変容するか，課題の設定の違いが学際的思考にどのような影響を与えるのかを明らかにする．

正司豪・石橋希・尾澤重知,『日本教育工学会論文誌』49(4), 701–717 (2025).

**배울 점**
- 「本研究の目的は…ことである．」로 시작해 목적을 먼저 확정(重点先行).
- 「具体的には」로 추상 → 구체 순서를 명시.
- 「」로 조작적 개념을 묶어 중의성을 차단.

---

## 1-6. 일본어 — 배경 → 선행연구의 빈틈 → 본연구

> 受験は，子ども達やその家族にとって大きなライフイベントである。中学受験を「試練」ととらえ成長を感じる者もいる一方，年齢に見合わない勉強量や親の過干渉により，中学受験を否定的にとらえる者も一定数いる。受験を巡る言説は散見されるが，実証的研究は極めて少なく，中学受験を取り上げた心理学的な研究はほとんどない。本研究は，中学受験を経験した当事者が，社会に出た後に自らの経験をどのように意味づけしているのかに関し，25―39歳の男女536名の回答を分析した。

大橋恵・井梅由美子・藤後悦子,『教育心理学研究』74(2), 65–79 (2026).

**배울 점**
- 「が」를 **역접에서만** 썼다(「散見されるが」). 일본어에서 「が」를 단순 연결로 남발하면 논리가 흐려진다.
- 一文一義가 끝까지 지켜진다.
- 빈틈을 「極めて少なく」「ほとんどない」로 두 단계에 걸쳐 좁혔다.

---

## 1-7. 한국어 — 정의 → 핵심 → 전환

> 공유의사결정(shared decision-making, SDM)은 의료인이 해당 임상 상황에서 가능한 선택지와 각 선택지의 이익, 위험 및 불확실성을 설명하고, 환자가 자신의 선호와 가치, 생활 여건, 감당할 수 있는 부담을 밝히며, 양측이 이를 바탕으로 숙의를 거쳐 결정을 함께 형성해 가는 과정이자 실천 체계이다. SDM의 핵심은 환자가 우선시하는 가치, 유지하고자 하는 일상과 기능, 감수 가능한 부담, 수용하기 어려운 결과를 의료 선택의 중심에 놓는 데 있다. …
>
> 그러나 한국의 의료 결정, 특히 중증질환에서의 의사결정은 환자-의료인 양자 관계만으로 설명되기 어렵다. …

유상호,「한국 의료에서 공유의사결정과 가족」, 『대한의사협회지』 69(7), 577–585 (2026).

**배울 점**
- 첫 문장이 길지만 `A하고, B하며, 양측이 C하는 과정`으로 **병렬 구조가 일정**해 따라 읽힌다. 길이 자체가 문제가 아니라 구조가 없는 길이가 문제다.
- 약어를 첫 등장에서 원어와 함께 정의하고 이후 일관되게 SDM만 쓴다.
- 문단 전환을 「그러나」 한 단어로 명확히 표시하고, 곧바로 반전 명제를 제시한다.
- 번역투(`~에 의해`, `가지다`, `되어지다`)가 없다.

---

## 1-8. 대조군 — 실제로 다듬을 여지가 있는 한국어 초록

> 본 연구결과를 통해 간호대학생이 앞으로 임상 현장에서 경험하게 되는 다양한 스트레스 상황을 적절한 대처하고 적응하면서 전문직 간호역량을 높이기 위해 대학교육에서부터 자아존중감과 자기효능감을 증진시키려는 노력이 필요하다 여겨지며, 자아존중감과 자기효능감을 활용한 자아탄력성 향상 프로그램 개발과 적용이 요구된다.

이선영·이정숙·김윤영,『디지털융복합연구』15(5), 401–409 (2017).

**진단** — 한재영(2015)이 뽑은 고빈도 문제 사례가 그대로 관찰된다.

- `본 연구결과를 통해` → 번역투
- `~여겨지며`, `~이 요구된다` → 주체 없는 피동
- `적절한 대처하고` → 주어–서술어 호응 오류
- 한 문장 130자 이상, 논점 2개(교육 필요 + 프로그램 개발)

**교정**

> 이 결과는 대학 교육 단계에서 자아존중감과 자기효능감을 함께 높여야 함을 보여준다. 두 요인을 활용한 자아탄력성 향상 프로그램을 개발하고 현장에 적용할 것을 제안한다.

---

# 2부. Before / After 교정 예문

## 2-1. 한국어 — 번역투와 피동

| # | Before | After | 적용 원칙 |
|---|---|---|---|
| 1 | 본 연구에서는 A에 대한 분석이 수행되었다. | 이 연구는 A를 분석했다. | 피동 제거, `~에 대한` 제거 |
| 2 | 해당 기능은 사용자의 데이터의 처리의 지연을 야기시킬 가능성을 가진다. | 이 기능은 사용자 데이터 처리를 지연시킬 수 있다. | `의` 연쇄 절단, `가지다` 제거, `시키다` 정리 |
| 3 | 이러한 결과를 통해 볼 때, 유의미한 시사점이 도출되어졌다고 할 수 있을 것이다. | 이 결과는 X가 Y에 영향을 준다는 것을 보여준다. | 이중 피동 제거, 학술 클리셰 제거, 내용 채우기 |
| 4 | 배포에 있어서 문제가 발생되어 확인이 필요한 상황입니다. | 배포가 실패했습니다. 원인 확인이 필요합니다. | `~에 있어서`(において) 제거, 한 문장 한 논점 |
| 5 | 성능 개선이 이루어질 수 있도록 최적화를 진행하였습니다. | 쿼리를 최적화해 응답 시간을 320ms에서 90ms로 줄였습니다. | 명사화 해체, 근거 수치 추가 |

## 2-2. 영어 — Gopen & Swan 적용

**(a) 주어와 동사 분리**

> ✗ The smallest of the URF's (URFA6L), a 207-nucleotide reading frame overlapping out of phase the NH2-terminal portion of the adenosinetriphosphatase subunit 6 gene, **has been identified** as …
>
> ✓ The smallest of the URF's **is** URFA6L, a 207-nucleotide reading frame … **It has been identified** as …

주어와 동사 사이 23단어를 끊어 두 문장으로 나눈 것이다. (Gopen & Swan 1990)

**(b) 강조 위치**

> ✗ A 40% reduction in latency was observed in our experiments, which we ran on eight GPUs.
>
> ✓ In experiments on eight GPUs, our method **reduced latency by 40%**.

기억시킬 정보를 문장 끝으로 옮겼다.

**(c) 명사화 → 동사**

> ✗ An evaluation of the performance of the system was carried out by the team.
>
> ✓ We evaluated the system's performance.
>
> ✗ The implementation of the proposed modification resulted in an improvement of throughput.
>
> ✓ The proposed change improved throughput.

EASE: "Do not overuse passive constructions." / digital.gov: 숨은 동사(`-tion`)를 되살린다.

**(d) 과잉 hedge**

> ✗ It could potentially be suggested that the results may possibly indicate a somewhat improved outcome under certain conditions.
>
> ✓ The results indicate a 12% improvement (95% CI, 7–17) under condition A. Whether this holds under condition B remains untested.

불확실성을 말로 흐리지 말고 **범위와 미검증 영역으로** 명시한다. (Ryba et al. 2021)

**(e) 학술 클리셰**

> ✗ These novel findings robustly elucidate a paradigm that underscores the critical importance of the mechanism.
>
> ✓ These findings show that the mechanism controls X.

일반 학술 은어가 130년간 가독성을 떨어뜨린 주범이다. (Plavén-Sigray et al. 2017)

## 2-3. 일본어 — 文化庁 기준 적용

| # | Before | After | 적용 원칙 |
|---|---|---|---|
| 1 | 本システムにおいては，データの処理の遅延が発生することが確認された。 | 本システムでは，データ処理が遅延した。 | 「の」連続回避, 受身抑制, 一文短縮 |
| 2 | 検討を行った結果，改善が必要でないとは言えないと考えられる。 | 検討の結果，改善が必要である。 | 二重否定の排除 (コ) |
| 3 | 昨日実施した負荷試験で問題が見つかったが，報告する。 | 昨日実施した負荷試験で問題が見つかったため，報告する。 | 「が」を逆接以外に使わない (カ) |
| 4 | 新しく開発した高速な検索機能を，多くのユーザーが日常的に利用している業務画面に追加した。 | 多くのユーザーが日常的に利用している業務画面に，新しく開発した高速な検索機能を追加した。 | 長い修飾節を先に (ク) |
| 5 | 結論としては，これらの点を踏まえた上で今後検討していく必要があると思われる。 | 結論として，A案を採用する。理由は B である。 | 結論先行, ぼかし排除 |

---

## 3부. 이 스킬 자체의 사용 예 (질문 → 초안)

**사용자 입력**

> 결제 API가 자꾸 죽는데 이슈 좀 써줘

**진단** — 채워진 슬롯: 1(GH issue), 5(일부). 빈 슬롯: 2·3·4·6·7.

**질문 (3문항)**

- `[처리 방향]` 이 이슈로 원하는 결과는? → "담당자가 이번 스프린트에 고침(추천)" / "원인 조사부터 요청" / "기록만 남김"
- `[근거]` 지금 가진 자료는? (복수) → 에러 로그 / 재현 절차 / 실패 테스트 / 모니터링 대시보드 / 없음
- `[독자]` 읽는 사람은? → "같은 저장소 담당 팀(추천)" / "다른 팀" / "외부 사용자"

**확정 한 줄**

> "결제 API가 특정 조건에서 500을 반환하니, 담당 팀이 이번 스프린트에 원인을 제거해달라."

이 한 줄이 확정되면 남은 건 형식 채우기뿐이다.
