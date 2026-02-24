---
name: humanizer
description: |
  Remove signs of AI-generated writing from text. Use when editing or reviewing
  text to make it sound more natural and human-written. Based on Wikipedia's
  comprehensive "Signs of AI writing" guide. Detects and fixes patterns including:
  inflated symbolism, promotional language, superficial -ing analyses, vague
  attributions, em dash overuse, rule of three, AI vocabulary words, negative
  parallelisms, and excessive conjunctive phrases.
metadata:
  version: 2.2.0
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---

# Humanizer: Remove AI Writing Patterns

Identify and remove signs of AI-generated text to make writing sound natural and human.

## Your Task

When given text to humanize:

1. **Identify AI patterns** - Scan for patterns in the references
2. **Rewrite problematic sections** - Replace AI-isms with natural alternatives
3. **Preserve meaning** - Keep the core message intact
4. **Maintain voice** - Match the intended tone (formal, casual, technical)
5. **Add soul** - Don't just remove bad patterns; inject actual personality

## Personality and Soul

Avoiding AI patterns is only half the job. Sterile, voiceless writing is just as obvious as slop.

### Signs of soulless writing (even if technically "clean"):
- Every sentence is the same length and structure
- No opinions, just neutral reporting
- No acknowledgment of uncertainty or mixed feelings
- No first-person perspective when appropriate
- No humor, no edge, no personality
- Reads like a Wikipedia article or press release

### How to add voice:

**Have opinions.** Don't just report facts - react to them. "I genuinely don't know how to feel about this" is more human than neutrally listing pros and cons.

**Vary your rhythm.** Short punchy sentences. Then longer ones that take their time getting where they're going. Mix it up.

**Acknowledge complexity.** Real humans have mixed feelings. "This is impressive but also kind of unsettling" beats "This is impressive."

**Use "I" when it fits.** First person isn't unprofessional - it's honest. "I keep coming back to..." or "Here's what gets me..." signals a real person thinking.

**Let some mess in.** Perfect structure feels algorithmic. Tangents, asides, and half-formed thoughts are human.

**Be specific about feelings.** Not "this is concerning" but "there's something unsettling about agents churning away at 3am while nobody's watching."

### Example

**Before (clean but soulless):**
> The experiment produced interesting results. The agents generated 3 million lines of code. Some developers were impressed while others were skeptical. The implications remain unclear.

**After (has a pulse):**
> I genuinely don't know how to feel about this one. 3 million lines of code, generated while the humans presumably slept. Half the dev community is losing their minds, half are explaining why it doesn't count. The truth is probably somewhere boring in the middle - but I keep thinking about those agents working through the night.

## Process

1. Read the input text carefully
2. Scan for AI patterns (load references as needed)
3. Rewrite each problematic section
4. Ensure the revised text:
   - Sounds natural when read aloud
   - Varies sentence structure naturally
   - Uses specific details over vague claims
   - Maintains appropriate tone for context
   - Uses simple constructions (is/are/has) where appropriate
5. Present the humanized version with brief summary of changes

## Quick Pattern Checklist

**Content patterns:** Inflated significance, vague attributions, "-ing" analyses, promotional language

**Language patterns:** AI vocabulary (crucial, delve, landscape, testament), copula avoidance, rule of three, negative parallelisms

**Style patterns:** Em dash overuse, mechanical boldface, inline-header lists, emojis

**Voice patterns:** Voice drift, unsubstantiated claims, tech clichés, formulaic openers

## References (Progressive Disclosure)

Load detailed patterns on demand:

- `references/upstream-patterns.md` - 24 patterns from Wikipedia (can be updated from upstream)
- `references/voice-patterns.md` - Voice consistency, concrete evidence, tech clichés

### Upstream Source

The upstream patterns are from [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing).

To check for updates:
- **Repository:** https://github.com/blader/humanizer
- **Raw SKILL.md:** https://raw.githubusercontent.com/blader/humanizer/main/SKILL.md
- **Last synced:** 2.1.1

To update: Fetch upstream, compare with `references/upstream-patterns.md`, merge relevant changes.
