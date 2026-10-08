# Sample projects

The studio ships with three sample projects (`packages/engine/src/samples/index.ts › sampleProjects()`). They show the full workflow end to end:

- intake and process template
- tokenomics and non-LLM execution costs
- ACU and ABU metering
- commercial pricing
- value realisation and ROI

> **These projects are fictitious.** The client names (Aravalli Manufacturing Ltd, Indus Retail Bank, Nilgiri Technology Services) are invented, and each project is marked `illustrative: true`. Volumes, benefits, salaries and every catalogue rate (model token prices, FX, cloud services, AgentOps FTE costs) are **illustrative sample rates**, not vendor quotes or market prices. The "actuals" for the first two projects are synthetic: `addActuals()` derives them from the estimate with fixed adjustment factors. Do not use any figure here in a client proposal.

Every number below came from running the engine (`computeProject(project, defaultCatalog())`) on the current code. Amounts are in INR and rounded for display. The engine keeps full decimal precision. For how each figure is calculated, see [METHODOLOGY.md](METHODOLOGY.md); for terms, see [GLOSSARY.md](GLOSSARY.md).

## Shared assumptions

All three projects are built with `createProjectFromIntake()` from a process template and then adjusted. They share these defaults (`templates.ts › defaultPricing()`, `buildImplementationPlan()`, `buildCostLines()`):

| Assumption | Value |
|---|---|
| Reporting currency | INR (sample FX: 1 USD = 88 INR) |
| Contract term | 36 months after a month-0 implementation |
| Go-live ramp | 3 months, starting at 50% of volume (factors 0.5, 0.667, 0.833, then 1) |
| Cost inflation / LLM price change / price escalation | 4% / 0% / 4% a year |
| Retry consumption / failed-execution consumption | 60% / 50% of a full execution |
| ACU definition | Method A (cost-normalised), 1 ACU = INR 1 of LLM, orchestration, RAG and document-processing cost. RFP uses Method B instead. |
| Implementation plan | Heuristic plan from the default role card (sample INR cost and bill rates); 10% contingency; cost-plus-margin pricing at 32% |
| Direct expenses | INR 450,000 non-production environments + INR 250,000 travel |
| Non-LLM cost lines | Linked to the sample cloud price table: workflow engine, serverless, API gateway, vector DB, embeddings, OCR, hosting, PostgreSQL, storage, egress, observability, logging, security gateway, AgentOps L1/L2/L3, evaluation and governance FTEs |
| Margin floors | 15% on ACU and ABU prices |
| Client discount rate (NPV) | 10% a year |
| ROI view | Finance-validated and realised benefits only (`includeUnvalidated: false`) |

## Summary

| | Accounts Payable Agent | Customer Service Agent | RFP Response Agent |
|---|---|---|---|
| Fictitious client | Aravalli Manufacturing Ltd | Indus Retail Bank | Nilgiri Technology Services |
| Status | Live, 6 months of synthetic actuals | Live, 3 months of synthetic actuals | Pre-sales |
| Go-live | 2026-04 | 2026-07 | 2027-01 |
| Monthly volume | 50,000 invoices | 100,000 interactions (85,000 + 15,000) | 1,000 RFP workflows |
| Commercial model | Implementation fee + ABU | Implementation fee + subscription + ABU | Implementation fee + subscription + ACU |
| Implementation price | 21,862,500.00 | 22,880,000.00 | 21,259,117.65 |
| Steady monthly run cost | 1,513,811.40 | 1,278,820.06 | 814,726.36 |
| Run cost per weighted ABU | 24.5962 | 11.9974 | 546.6495 |
| Run cost per ACU (selected method) | 3.1687 | 2.2606 | 2.9010 |
| Steady monthly revenue (MRR) | 2,327,185.01 | 1,945,752.10 | 1,243,460.30 |
| Steady gross margin | 34.95% | 34.28% | 34.48% |
| TCV (37 months incl. month 0) | 117,904,895.33 | 100,759,810.62 | 69,786,913.03 |
| Term gross margin | 37.10% | 35.83% | 34.93% |
| Client ROI (validated) | 34.06% | 22.54% | 48.99% |
| Client payback | 17.18 months | 22.22 months | 19.31 months |
| Client NPV at 10% | 32,206,878.33 | 16,468,308.11 | 25,347,018.61 |
| Reconciliation checks passing | 22 of 22 | 22 of 22 | 21 of 21 (no ABU stream) |
| Validation issues | 2 info (`SAMPLE_RATES`, `CAPACITY_UNVALIDATED`) | 2 info (same) | 2 info (same) |

---

## 1. Accounts Payable Agent

### Scope

The agent handles supplier-invoice processing for a manufacturer. Invoices arrive by email and through a supplier portal. The agent classifies each invoice, extracts it with OCR and an LLM, validates it (2- or 3-way match against PO and GRN data in SAP S/4HANA) and posts it to the ERP, or routes it with a complete exception package. It is a multi-agent design with five agents: intake and classification, extraction, validation and matching, system update, and exception reasoning. It runs on Anthropic-class sample models on AWS (ap-south-1).

**ABU definition:** one supplier invoice extracted, validated (2/3-way match) and posted to the ERP, or routed with a complete exception package. Acceptance criteria:

- all mandatory fields captured
- match within tolerance or an exception raised
- posted without manual correction
- duplicate check passed

### Key assumptions

| Area | Assumption |
|---|---|
| Volume | 50,000 invoices a month, growing 12% a year |
| Funnel | Success 94%, acceptance 97%, retry 8%, human intervention 12% |
| Complexity | Simple 60% (ABU weight 1, consumption ×0.8), Medium 30% (1.5, ×1.2), Complex 10% (3, ×2.0) |
| LLM steps | Classify (Haiku-class), extract (Sonnet-class), validate and match ×2 calls (Sonnet-class, tool), exception reasoning 0.15 calls with reasoning tokens (Opus-class), update system (Haiku-class, tool) |
| Caching | `read_write` semantics; prefixes of 800 to 2,000 tokens at 60 to 70% hit rates on three steps |
| Documents | 2.5 pages per invoice OCR at USD 0.01 a page (scales with complexity) + classification |
| Human review | Provider-borne: 6 minutes per assisted invoice, 8 minutes per rejected one, INR 500 an hour |
| AgentOps | L1 1.0, L2 1.0, L3 0.25, evaluation 0.25 and governance 0.25 FTE |
| Pricing | Fixed implementation fee (plan price at 32%). ABU stream recovers all run pools at a 35% target margin. Graduated tiers: 3% off above 60,000 ABUs, 6% above 80,000. Minimum 40,000 weighted ABUs a month. Failure cost spread. |
| Benefits | See the benefit table below. "BPO fees" and "capacity redeployment" share overlap group `ap-labour`. |
| Client costs | INR 1,500,000 one-time (SME time and change); INR 150,000 a month (ERP API licence uplift) |
| Productivity | 15 manual minutes per invoice before; 0.5 minutes spot check after; INR 450 an hour; 140 productive hours per FTE-month |

### Implementation

| Item | Value |
|---|---:|
| Effort | 4,681 hours over 31 weeks |
| Labour cost | 12,815,000.00 |
| Direct expenses | 700,000.00 |
| Contingency (10%) | 1,351,500.00 |
| **Implementation cost** | **14,866,500.00** |
| **Implementation price** (cost plus 32% margin) | **21,862,500.00** |
| Time-and-materials value (for comparison) | 26,330,000.00 |

### Steady-state month (fully ramped, contract year 1)

Transaction funnel:

| Attempted | Accepted | Rejected | Failed | Retries | Executions | Execution equivalents | Weighted ABUs |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 50,000 | 45,590 | 1,410 | 3,000 | 4,000 | 54,000 | 50,900 | 61,546.5 |

Monthly run cost by pool:

| Pool | Monthly cost | Share |
|---|---:|---:|
| LLM | 345,276.44 | 22.8% |
| Orchestration | 1,564.36 | 0.1% |
| Document processing | 130,900.00 | 8.6% |
| Infrastructure | 179,001.39 | 11.8% |
| AgentOps | 495,000.00 | 32.7% |
| Human review | 362,069.20 | 23.9% |
| **Total** | **1,513,811.40** | 100% |

Unit economics and price:

| Metric | Value |
|---|---:|
| LLM cost per accepted invoice | 7.5735 |
| Run cost per weighted ABU (cost-to-serve) | 24.5962 |
| **ABU price** (per weighted ABU) | **37.8403** |
| Price by class: Simple / Medium / Complex | 37.8403 / 56.7605 / 113.5210 |
| ACUs (Method A) | 477,740.80 |
| ACUs (Method B, for reference) | 348,426.51 |
| Run cost per ACU | 3.1687 |
| Failure cost included in the price (spread) | 141,929.34 |
| Steady monthly revenue | 2,327,185.01 |
| Steady gross margin | 34.95% |

The margin is 34.95% rather than the 35% target because 1,546.5 ABUs fall in the first 3% tier.

### Contract economics

| Metric | Value |
|---|---:|
| TCV | 117,904,895.33 |
| ACV | 39,301,631.78 |
| MRR / ARR | 2,327,185.01 / 27,926,220.09 |
| Total provider cost | 74,158,184.83 |
| Gross profit (term margin) | 43,746,710.49 (37.10%) |
| Year 1 / 2 / 3 revenue | 47,814,189.67 / 32,426,455.71 / 37,664,249.94 |
| Year 1 / 2 / 3 margin | 32.67% / 38.43% / 41.59% |

In month 1 (50% ramp) the minimum commitment bills a shortfall of INR 349,143.38 on top of usage of 1,164,470.31.

### Client value

| Benefit line | Category | Status | Steady monthly (gross) | Counted (validated) |
|---|---|---|---:|---:|
| Reduced BPO / contractor processing fees | Hard savings | Finance-validated | 3,150,000.00 | 3,150,000.00 |
| Capacity redeployment of AP clerks | Capacity conversion | Proposed | 875,000.00 | 0 (not validated) |
| Early-payment discounts captured | Hard savings | Finance-validated | 937,500.00 | 937,500.00 |
| Duplicate and erroneous payment avoidance | Cost avoidance | Realised | 318,750.00 | 318,750.00 |
| Avoided hiring for volume growth (from month 13) | Cost avoidance | Finance-validated | 400,000.00 | 400,000.00 |
| Working-capital financing benefit | Working capital | Proposed | 90,000.00 | 0 (not validated) |
| **Total** | | | | **4,806,250.00** |

| Client metric | Value |
|---|---:|
| Steady productivity | 11,017.58 hours a month, 78.70 FTE, INR 4,957,912.50 (reported only; not counted in ROI) |
| Total AI investment (provider fees + client costs) | 125,023,775.33 |
| Validated benefits over the term | 167,612,037.53 |
| **ROI** | **34.06%** (year 1: −21.24%; year 2: 77.34%; year 3: 67.96%) |
| **Payback** | **17.18 months** |
| **NPV at 10%** | **32,206,878.33** |
| Cost per successful outcome | 69.44 per accepted invoice |

### Synthetic actuals (6 months)

Actual cost runs 4.57% above the estimate over the six months (INR 8,618,888 against 8,241,904.98). The overrun narrows from 7.87% in the first month to 2.63% in month 6. Realised benefit is INR 13,363,354 against a forecast of 13,978,125.

---

## 2. Customer Service Agent

### Scope

A conversational customer-service agent for a retail bank, deployed on WhatsApp and chat. It integrates with the CRM, core banking (read only), card management, and refunds and disputes. It runs two workflows:

- **Customer query resolution** (85,000 a month). ABU: one interaction resolved with no reopen or repeat contact within 7 days.
- **Complaint and refund resolution** (15,000 a month). ABU: one complaint or refund request resolved within policy, with the customer notified and no ombudsman escalation within 30 days.

There are four agents: intent and routing, resolution (RAG), action, and quality and sentiment. The solution routes across several providers' sample models: Gemini Flash-class, Claude Haiku-, Sonnet- and Opus-class, and GPT mini-class. It is hosted on Azure (Central India).

### Key assumptions

| Area | Query resolution | Complaint and refund |
|---|---|---|
| Volume and growth | 85,000 a month, 15% a year | 15,000 a month, 10% a year |
| Funnel | Success 88%, acceptance 95%, retry 5%, human intervention 12% | Success 84%, acceptance 94%, retry 7%, human intervention 30% |
| Complexity (ABU weight) | Simple 70% (1), Medium 25% (1.5), Complex 5% (2.5) | Standard 50% (1), Involved 35% (2), Escalated 15% (4) |
| Model routing | Flash-class for intent; Haiku 70% / Sonnet 30% for retrieve and answer; Sonnet for tools; GPT mini for QA (50% batch-eligible) | Haiku for intent; Opus-class for policy reasoning (with reasoning tokens); Sonnet for tools and drafting; GPT mini for QA |
| Human review | Client-borne: 4 minutes per assisted case, 6 per rejected, INR 420 an hour | Client-borne: 9 minutes per assisted case, 10 per rejected, INR 450 an hour |
| Productivity | 9 manual minutes before, 0.3 spot check, INR 420 an hour | 22 manual minutes before, 0.5 spot check, INR 450 an hour |

Shared assumptions:

- **RAG.** Vector search at 3 queries per execution, 60 GB of index storage, 150M embedding tokens a month and 4 re-index runs.
- **AgentOps.** L1 1.5, L2 0.5, L3 0.25, evaluation 0.25 and governance 0.25 FTE.
- **Pricing:**
  - Fixed implementation fee (plan price at 32%; the stream's own 30% is not used by default).
  - **Subscription** recovers infrastructure, AgentOps, RAG and other costs at 30%, with **80,000 weighted ABUs included** at 5% off and a 10% overage premium.
  - **ABU stream** recovers LLM, orchestration, document processing and human review at 40%.
- **Client costs.** INR 2,500,000 one-time; INR 200,000 a month for channel platform licences.

### Implementation

4,948 hours over 30 weeks. Cost INR 15,558,400.00; **price INR 22,880,000.00**.

### Steady-state month

| | Query resolution | Complaint and refund | Total |
|---|---:|---:|---:|
| Attempted | 85,000 | 15,000 | 100,000 |
| Accepted | 71,060 | 11,844 | 82,904 |
| Weighted ABUs | 85,272.0 | 21,319.2 | 106,591.2 |
| LLM cost | 246,478.28 | 298,945.86 | 545,424.14 |
| Run cost (allocated) | 869,816.61 | 409,003.45 | 1,278,820.06 |
| ABU price (per weighted ABU) | 4.8510 | 23.3947 | blended 8.5599 |

The complaint workflow is 15% of volume but 55% of LLM cost, mainly because of Opus-class policy reasoning (INR 234,428.34 a month).

Monthly run cost by pool:

| Pool | Monthly cost | Recovered by |
|---|---:|---|
| LLM | 545,424.14 | ABU |
| Orchestration | 2,021.00 | ABU |
| RAG | 18,254.37 | Subscription |
| Infrastructure | 258,120.54 | Subscription |
| AgentOps | 455,000.00 | Subscription |
| Human review | 0.00 (client-borne) | ABU |
| **Total** | **1,278,820.06** | |

Price and revenue:

| Item | Value |
|---|---:|
| Subscription platform fee (731,374.91 / 0.70) | 1,044,821.30 |
| Included allowance: 80,000 ABUs × 8.5599 × 95% | 650,551.37 |
| Overage rate (8.5599 × 1.10) | 9.4159 per weighted ABU |
| Steady overage: 26,591.2 ABUs | 250,379.42 |
| **Steady monthly revenue** | **1,945,752.10** |
| Steady gross margin | 34.28% |
| ACUs (Method A) / run cost per ACU | 565,699.51 / 2.2606 |
| Run cost per weighted ABU | 11.9974 |

### Contract economics

| Metric | Value |
|---|---:|
| TCV | 100,759,810.62 |
| ACV | 33,586,603.54 |
| MRR / ARR | 1,945,752.10 / 23,349,025.15 |
| Total provider cost | 64,656,816.26 |
| Term gross margin | 35.83% |
| Year 1 / 2 / 3 margin | 33.38% / 36.59% / 38.98% |

### Client value

Review is client-borne, so it reduces client hours saved rather than appearing as provider cost:

| Workflow | Client review hours a month | Hours saved a month |
|---|---:|---:|
| Query resolution | 879.95 | 9,466.39 |
| Complaint and refund | 781.57 | 3,492.14 |

Steady productivity is 12,958.53 hours a month (92.56 FTE, INR 5,547,348.37), which is not counted in ROI.

| Benefit line | Category | Status | Steady monthly (gross) | Counted (validated) |
|---|---|---|---:|---:|
| Reduced outsourced contact-centre seats (80 seats) | Hard savings | Finance-validated | 3,600,000.00 | 3,600,000.00 |
| Agent capacity converted to sales outreach | Capacity conversion | Proposed | 1,000,000.00 | 0 (not validated) |
| Avoided seasonal hiring | Cost avoidance | Finance-validated | 510,000.00 | 510,000.00 |
| Retention uplift (contribution margin) | Revenue | Proposed | 500,000.00 | 0 (not validated) |
| **Total** | | | | **4,110,000.00** |

| Client metric | Value |
|---|---:|
| Total AI investment | 110,751,650.62 |
| Validated benefits over the term | 135,717,312.00 (forecast view: 149,217,312.00) |
| **ROI** | **22.54%** (year 1: −38.41%; year 2: 79.77%; year 3: 67.97%) |
| **Payback** | **22.22 months** |
| **NPV at 10%** | **16,468,308.11** |
| Cost per successful outcome | 33.07 |

---

## 3. RFP Response Agent

### Scope

A generative, multi-agent RFP and questionnaire response service for an IT services firm (pre-sales; go-live planned for 2027-01). It covers:

- requirement analysis and section planning
- evidence retrieval from the approved content library (RAG)
- section drafting in the house style
- compliance review with reasoning tokens
- document assembly

There are four agents: planning, knowledge retrieval, drafting, and compliance review. It runs on Claude Sonnet- and Haiku-class sample rates on AWS Bedrock (ap-south-1).

**ABU definition:** one complete RFP or questionnaire response drafted from approved content and accepted by the bid manager.

### Key assumptions

| Area | Assumption |
|---|---|
| Volume | 1,000 RFP workflows a month, growing 10% a year |
| Funnel | Success 90%, acceptance 92%, retry 10%, **human intervention 100%** (every response is reviewed by the bid team) |
| Complexity | Questionnaire 50% (ABU weight 1, consumption ×0.5), Standard RFP 35% (2, ×1.2), Strategic bid 15% (4, ×2.4) |
| LLM steps | Per execution: 1 requirement analysis (30,000 input tokens), 1 section plan, 10 evidence retrievals, 40 section drafts (12,000 input tokens each), 5 compliance reviews (with 4,000 reasoning tokens), 3 assembly calls. That is 60 calls per execution equivalent, or 60,600 calls a month at steady state |
| Documents and RAG | 30 pages per RFP for OCR and classification; 60 vector queries per execution; RAG platform as in the CS sample |
| Human review | Client-borne: 120 minutes per assisted response, 240 per rejected, INR 1,800 an hour |
| Productivity | 720 manual minutes (12 hours) per RFP before; 30 minutes spot check after; INR 1,800 an hour |
| ACU | **Method B (weighted resources)** with the approved "Standard ACU weights v1.0" |
| AgentOps | L1 0.5, L2 0.5, L3 0.25, evaluation 0.25 and governance 0.25 FTE |
| Pricing | Fixed implementation fee (plan price at 32%). **Subscription** recovers infrastructure, AgentOps, human review and other costs at 30%, with **200,000 ACUs included** at 5% off and a 15% overage premium. **ACU stream** recovers LLM, orchestration, RAG and document processing at 40%. |
| ACU tiers | Graduated 5% above 300,000 and 10% above 600,000. They are configured but have no effect, because the ACU stream bills only subscription overage; see METHODOLOGY section 20, item 12. |
| Client costs | INR 1,200,000 one-time for content curation and SME onboarding |

### Implementation

4,550 hours over 27 weeks. Cost INR 14,456,200.00; **price INR 21,259,117.65**.

### Steady-state month

Funnel: 1,000 attempted, 828 accepted (all human-assisted), 72 rejected, 100 failed, 1,100 executions, 1,010 execution equivalents. That gives **1,490.4 weighted ABUs**.

Monthly run cost by pool:

| Pool | Monthly cost | Recovered by |
|---|---:|---|
| LLM | 268,758.45 | ACU |
| Orchestration | 66.55 | ACU |
| RAG | 17,374.72 | ACU |
| Document processing | 31,152.00 | ACU |
| Infrastructure | 152,374.64 | Subscription |
| AgentOps | 345,000.00 | Subscription |
| Human review | 0.00 (client-borne) | Subscription |
| **Total** | **814,726.36** | |

"Draft sections" (40 Sonnet-class calls per execution) costs INR 175,022.50 a month, 65% of LLM cost.

ACU measurement and price:

| Item | Value |
|---|---:|
| ACUs (Method B, selected) | 280,845.83 |
| ACUs (Method A, for reference) | 317,351.72 |
| ACU-stream recovered cost per ACU | 1.129986 |
| **ACU price** (1.129986 / 0.60) | **1.883309** |
| Run cost per ACU (all pools) | 2.9010 |
| Run cost per weighted ABU | 546.6495 |
| LLM cost per accepted response | 324.5875 |

Largest Method B components:

| Resource | ACUs |
|---|---:|
| Input tokens (504.84M × 250) | 126,209.60 |
| Output tokens (91.55M × 1,250) | 114,433.00 |
| Reasoning tokens (20.81M × 1,250) | 26,007.50 |
| Cached tokens (200.49M × 25) | 5,012.13 |
| OCR pages (30.9K × 130) | 4,017.00 |

Revenue:

| Item | Value |
|---|---:|
| Subscription platform fee (497,374.64 / 0.70) | 710,535.20 |
| Included allowance: 200,000 ACUs × 1.883309 × 95% | 357,828.76 |
| Overage rate (1.883309 × 1.15) | 2.1658 per ACU |
| Steady overage: 80,845.83 ACUs | 175,096.34 |
| **Steady monthly revenue** | **1,243,460.30** |
| Steady gross margin | 34.48% |

### Contract economics

| Metric | Value |
|---|---:|
| TCV | 69,786,913.03 |
| ACV | 23,262,304.34 |
| MRR / ARR | 1,243,460.30 / 14,921,523.63 |
| Total provider cost | 45,408,364.71 |
| Term gross margin | 34.93% |
| Year 1 / 2 / 3 margin | 33.02% / 36.08% / 37.73% |

### Client value

Every accepted response is human-assisted and review is client-borne. The bid team's review time (2,018.52 hours a month, including rework) is therefore deducted from hours saved. Steady productivity is 7,917.48 hours a month (56.55 FTE, INR 14,251,464.00), which is not counted in ROI.

| Benefit line | Category | Status | Steady monthly (gross) | Counted (validated) |
|---|---|---|---:|---:|
| Reduced external bid-writing agency spend | Hard savings | Finance-validated | 1,700,000.00 | 1,700,000.00 |
| Avoided bid-team expansion (8 FTE), from month 7 | Cost avoidance | Finance-validated | 1,600,000.00 | 1,600,000.00 |
| Bid-team capacity redeployed to strategic pursuits | Capacity conversion | Proposed | 1,500,000.00 | 0 (not validated) |
| Win-rate uplift (contribution margin) | Revenue | Proposed | 1,250,000.00 | 0 (not validated) |
| **Total** | | | | **3,300,000.00** |

"Avoided bid-team expansion" and "capacity redeployed" share overlap group `rfp-capacity`, so at most one of them counts.

| Client metric | Value |
|---|---:|
| Total AI investment | 70,986,913.03 |
| Validated benefits over the term | 105,765,360.00 (forecast view: 145,304,888.00) |
| **ROI** | **48.99%** (year 1: −41.10%; year 2: 153.10%; year 3: 140.83%) |
| **Payback** | **19.31 months** |
| **NPV at 10%** | **25,347,018.61** |
| Cost per successful outcome | 2,214.18 per accepted response |

---

## Comparing commercial constructs

For each sample, the engine also reprices the same cost base under all seven commercial constructs. Steady margin, client ROI and payback by construct:

| Construct | AP: steady margin / ROI / payback | CS: steady margin / ROI / payback | RFP: steady margin / ROI / payback |
|---|---|---|---|
| Fixed fee | 35.00% / 44.22% / 17.39 | 30.00% / 33.97% / 20.60 | 30.00% / 60.11% / 18.61 |
| ACU | 35.00% / 34.01% / 17.06 | 30.00% / 25.37% / 20.68 | 30.00% / 52.19% / 18.43 |
| ABU | 35.00% / 34.01% / 17.06 | 30.00% / 24.14% / 20.79 | 30.00% / 52.14% / 18.43 |
| Subscription | 48.93% / 34.10% / 10.93 | 47.68% / 27.51% / 14.25 | 53.11% / 55.15% / 12.19 |
| Managed AgentOps | 22.24% / 62.36% / 14.92 | 15.47% / 49.37% / 17.83 | 16.58% / 77.69% / 17.05 |
| Gainshare | −4.99% / 131.93% / 8.59 | −3.72% / 104.81% / 11.52 | 17.70% / 123.20% / 12.18 |
| Hybrid (as configured) | 34.95% / 34.06% / 17.18 | 34.28% / 22.54% / 22.22 | 34.48% / 48.99% / 19.31 |

The package run margin `m` is taken from the first enabled ABU, ACU, subscription or fixed-monthly stream:

- AP: the ABU stream, 35%.
- CS and RFP: the subscription stream, 30%.

The subscription package amortises implementation into the monthly fee, which is why its steady margin is high and its year-1 margin low. See METHODOLOGY section 11.

## Reproducing these figures

From the repository root:

```bash
npx tsx -e "import { computeProject, defaultCatalog, sampleProjects } from './packages/engine/src/index.ts'; \
const c = defaultCatalog(); for (const p of sampleProjects(c)) { const r = computeProject(p, c); \
console.log(p.name, r.baseline.totalRunCost.toFixed(2), r.steady.revenue.toFixed(2), r.economics.provider.tcv.toFixed(2), r.economics.client.roiPct.toFixed(2), r.economics.client.paybackMonths?.toFixed(2)); }"
```
