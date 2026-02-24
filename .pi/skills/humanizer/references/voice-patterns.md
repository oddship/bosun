# Voice and Authenticity Patterns

Additional patterns for voice consistency, concrete evidence, and technical writing. These complement the upstream patterns with observations from practical editing work.

---

## VOICE PATTERNS

### 25. Voice Drift and Inconsistency

**Problem:** Different sections sound like different writers. Tone shifts from formal to casual to formal again.

**Signs:**
- Sentence length varies wildly between sections
- First-person usage ("I/we") appears and disappears
- Humor in one section, corporate-speak in another
- Technical depth inconsistent (over-explains basics, skips complex parts)

**Before:**
> The system uses a sophisticated machine learning pipeline to optimize resource allocation. 
> Honestly, we just threw some algorithms at the problem and it worked.
> The implementation represents a paradigm shift in distributed computing.

**After:**
> We built a machine learning system to optimize resource allocation. 
> It worked better than expected, especially for memory-intensive tasks.
> The approach is now our standard for distributed systems.

**How to check:**
1. Read the first paragraph, note the voice (formal/casual, first-person, sentence length)
2. Read the last paragraph, compare
3. If they feel like different authors, there's drift

---

### 26. Unsubstantiated Claims

**Problem:** Claims lack specific evidence or examples.

**Vague patterns to watch:**
- "Many developers..." (how many? which developers?)
- "It's widely used..." (where? by whom?)
- "This approach is better..." (better by what metric?)
- "Companies are adopting..." (which companies? when?)
- "Research shows..." (what research? link it)
- "Best practices suggest..." (whose practices? cite source)

**Before:**
> This pattern is widely adopted by leading tech companies for its efficiency benefits.

**After:**
> Stripe and Shopify use this pattern. In our benchmarks, it reduced latency by 40%.

**Before:**
> Many developers prefer this approach because it's more intuitive.

**After:**
> I prefer this approach because the error messages are clearer. Three teammates independently said the same thing during code review.

---

### 27. Tech-Specific Overused Phrases

**High-frequency tech clichés:**
- leverage, synergy, cutting-edge, best-in-class
- industry-leading, paradigm shift, game-changer
- next-generation, seamless integration, robust solution
- scalable architecture, optimize, empower, transform
- holistic approach, ecosystem, end-to-end
- state-of-the-art, mission-critical, enterprise-grade

**Before:**
> We leveraged cutting-edge machine learning to empower our platform with next-generation capabilities, enabling seamless integration with existing systems.

**After:**
> We added machine learning to our platform. It integrates with existing APIs and reduces processing time by 30%.

**Before:**
> Our holistic, end-to-end solution provides enterprise-grade scalability.

**After:**
> The system handles 10x our current load without code changes.

---

### 28. Formulaic Sentence Openers

**Problem:** Same opening patterns repeated throughout.

**Common formulas to avoid:**
- "It's important to note that..."
- "As we move forward..."
- "The reality is..."
- "At the end of the day..."
- "When it comes to..."
- "The bottom line is..."
- "In today's world..."
- "Let's dive into..."
- "With that said..."
- "That being said..."

**Audit technique:** Scan first 3 words of each sentence. If you see the same pattern more than twice in a section, rewrite.

**Before:**
> It's important to note that security is critical. It's important to note that we've added encryption. It's important to note that users should update.

**After:**
> Security matters. We added encryption. Update your app to get the fix.

---

## COMPARATIVE VOICE ANALYSIS

When editing against established writing (e.g., matching a tech blog's voice):

### Step 1: Extract Voice Markers from Reference

Read the reference material and note:
- Average sentence length (count words in 5-10 sentences)
- First-person frequency ("I/we" per paragraph)
- Humor/personality indicators (jokes, asides, opinions)
- Technical depth (assumes knowledge vs. explains everything)
- Specificity (concrete examples vs. general claims)

### Step 2: Audit Your Text

Compare your text against the same markers:
- Are sentences similar length on average?
- Do you use "I/we" at similar rates?
- Is personality consistent?
- Are technical explanations at same depth?
- Do you have similar specificity in examples?

### Step 3: Adjust to Match

Don't just remove AI patterns - actively match the reference voice:
- If reference uses short sentences, shorten yours
- If reference is opinionated, add your opinions
- If reference uses concrete examples, add your own
- If reference is casual, loosen up your tone

---

## CONCRETE EVIDENCE AUDIT

### Checklist

For each major claim in your text:

| Claim | Evidence Type | Provided? |
|-------|---------------|-----------|
| "Performance improved" | Metric (latency, throughput) | Yes/No |
| "Developers prefer X" | Survey, interviews, quotes | Yes/No |
| "This is widely used" | Companies, projects, numbers | Yes/No |
| "The approach is better" | Comparison, benchmark | Yes/No |

### Evidence Hierarchy

**Strong evidence (prefer these):**
- Specific numbers ("reduced latency by 40%")
- Named sources ("according to Stripe's engineering blog")
- Personal experience ("in my testing, it took 3 seconds")
- Quotes ("the team lead said 'this is cleaner'")

**Weak evidence (avoid these):**
- Vague attribution ("experts say")
- Unquantified claims ("significantly improved")
- Appeal to popularity ("everyone uses this")
- Future speculation ("this will revolutionize")

---

## BLOG-SPECIFIC REFINEMENT WORKFLOW

When refining technical blog posts:

### Pass 1: Remove AI Patterns
Load `references/upstream-patterns.md` and scan for the 24 patterns.

### Pass 2: Check Voice Consistency
- Read intro and conclusion - do they match?
- Check sentence length variance across sections
- Verify first-person usage is consistent

### Pass 3: Audit Concrete Evidence
- Every claim needs a source or example
- Convert "many/some/most" to specific numbers or names
- Replace "experts say" with "I found" or "[named source] says"

### Pass 4: Compare to Reference Voice
If matching an established blog:
- Extract markers from 2-3 reference posts
- Adjust your text to match those markers
- Read aloud - does it sound like the same author?

### Pass 5: Final Read
- Read the whole piece aloud
- Note anything that sounds mechanical or corporate
- Add personality where it feels flat
