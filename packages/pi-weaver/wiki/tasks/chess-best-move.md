# chess-best-move

**Category**: Vision/Reasoning  **Difficulty**: Hard
**Result**: Plain fail (901s timeout, $0.51) | Weaver fail (901s timeout, $0.80)
**Verdict**: weaver-hurts

## Task Description

Analyze a chess board image (`chess_board.png`), determine the best move for white, and write it to `/app/move.txt` in coordinate form (e.g., `e2e4`).

## What Happened

Both agents hit the 901-second timeout. Neither wrote a correct answer. But they burned very different amounts of money getting nowhere.

The core problem is the same for both: **you can't analyze a chess position if you can't read the board**. Both agents found Stockfish (at `/usr/games/stockfish`), both invoked it correctly, both got valid analysis back. The engine wasn't the bottleneck. The bottleneck was upstream — turning pixels into a FEN string.

**Plain** read the image, guessed a FEN, ran Stockfish, got suspicious results, tried different FEN variations (king at f5? g5? d1?), ran Stockfish again, got more suspicious results, repeat. Ten turns, nine bash calls, each one trying a slightly different board interpretation. $0.51.

**Weaver** did the same thing but more. Set a checkpoint, read the image, guessed a FEN, struggled with Stockfish I/O (multiple invocation methods before settling on one that worked), installed `python-chess` as a wrapper, got low-evaluation results (+34cp), systematically tried FEN variations in batch, re-read the image at T16 hoping for better piece identification. Sixteen turns, seventeen tool calls. $0.80.

Neither agent ever wrote to `/app/move.txt`. They both ran out of time still searching for the right position.

## The Incomplete Ceremony

Here's what's interesting about the weaver session: the agent set a "start" checkpoint but **never called time_lapse or done**. That's unique among my five tasks. In [fix-git](fix-git.md), [build-pmars](build-pmars.md), and [log-summary-date-ranges](log-summary-date-ranges.md), the agent used the full checkpoint→time_lapse→done sequence. In [sqlite-with-gcov](sqlite-with-gcov.md), it used all three. Here: just one checkpoint, then flailing.

I think this is actually a signal. The agent never felt confident enough to declare "orientation complete" and fast-forward. It never reached a "ready" state because it never *was* ready — it couldn't pin down the board position. The incomplete weaver ceremony is the model telling you "I don't know what I'm doing."

That could be a useful heuristic: if the agent has been running for N minutes and hasn't called time_lapse yet, something is fundamentally wrong. Maybe that's when you intervene — kill the session, provide the FEN manually, or switch to a vision-specialized model.

## Token Economics

| Metric | Plain | Weaver |
|--------|-------|--------|
| Turns | 10 | 16 |
| Tool calls | 10 (read:1, bash:9) | 17 (cp:1, read:2, bash:14) |
| Output tokens | 24,492 | 37,537 |
| Cache read | 121k | 261k |
| Total cost | $0.51 | $0.80 |
| Elapsed | 901s (timeout) | 901s (timeout) |

Weaver spent 57% more reaching the same timeout. Those extra output tokens are the model reasoning at length about FEN variations — generating more text didn't make the guesses more accurate.

## What This Teaches

**Weaver can't fix capability gaps.** If the model can't see the chess pieces correctly, no amount of structured planning or context management helps. Checkpoint/time_lapse is a *strategy* tool — it helps when the strategy is wrong. Here the strategy was fine (use Stockfish). The perception was wrong.

This is the hardest category for any self-correction framework: tasks where the agent doesn't know what it doesn't know. Both agents thought their FEN interpretations were plausible. They had no reliable way to verify a FEN against the image short of "does the Stockfish eval look reasonable?" — and reasonable is subjective.

The [polyglot-c-py](polyglot-c-py.md) page shows weaver helping when the agent *recognizes* it's stuck (rewind from a broken rewrite). Chess-best-move shows what happens when the agent can't even tell it's wrong. Self-correction requires self-awareness, and vision-to-symbolic-representation failures are invisible to the model.

One last thing: this task would be trivially solved by a chess-board OCR tool or a fine-tuned vision model. The right answer isn't "make the LLM try harder at reading chess positions." It's "give it a tool that reads chess positions." That's a lesson about agent design, not about weaver.
