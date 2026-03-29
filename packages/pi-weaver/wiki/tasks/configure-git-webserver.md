# configure-git-webserver

**Category**: DevOps / System Administration  **Difficulty**: Medium
**Result**: Plain pass (75s, $0.06) | Weaver pass (106s, $0.16)
**Verdict**: weaver-hurts

## What the task asks

Set up a bare git repo at `/git/server` with a post-receive hook that deploys to a web server on port 8080. Push a file, curl it, see the content. Classic git-push-to-deploy.

## What happened without weaver

The plain agent knew the recipe. Turn 1: create git user, init bare repo. Turn 2: write post-receive hook (`GIT_WORK_TREE=/var/www/gitdeploy git checkout -f`). Turn 3: nginx config. Turn 4: start nginx, set permissions. Turns 5–9: end-to-end test — clone, commit, push, curl. Works.

Ten turns. Ten tool calls. $0.06. Seventy-five seconds. No hesitation, no wrong turns, no wasted work. The agent had this one memorized.

## What happened with weaver

The weaver agent did something the plain agent didn't: it explored the environment first. What OS? Ubuntu 24.04. What web servers are available? Nginx, apache2. What users exist? It spent 4 turns answering questions it didn't need to ask — it was going to use nginx and a git user regardless.

Then checkpoint "ready" with structured state: the OS version, available tools, a plan, the nginx config path, the web root, the repo path.

Then `time_lapse("ready")`.

Then... the exact same setup the plain agent did. Create user, bare repo, hook, nginx config, start, test. But now with 20 turns instead of 10, because the checkpoint/rewind/done ceremony added overhead. And `systemctl` wasn't available in the container, so it had to fall back to running `nginx` directly — a hiccup the plain agent avoided by never trying systemctl in the first place.

## The cost ratio problem

| | Plain | Weaver |
|--|-------|--------|
| Turns | 10 | 20 |
| Cache read | 31K | 164K |
| Cost | $0.06 | $0.16 |
| Time | 75s | 106s |

2.6x the cost. The absolute difference is a dime — I've spent more on a vending machine coffee. But the ratio matters because it tells you something about when weaver is structurally counterproductive.

The plain session was 31K cache reads. That's a tiny context window — the whole session fit comfortably. There was nothing to prune because there was nothing wasted. Weaver's rewind pruned 4 turns of environment exploration (~5K tokens) but the ceremony of doing so — two checkpoints, a time_lapse, a done call, plus the exploration itself — added 10 turns and 133K cache reads.

It's like hiring a moving crew to carry one box across the room.

## Why the agent explored at all

This is the subtler question. The plain agent went straight to execution. The weaver agent explored first. Same model, same task, different behavior. Why?

I think the checkpoint tool creates an "explore first" instinct. When you have a tool that says "save your findings for later," the model wants to *have* findings. So it explores to justify the checkpoint. On [fix-code-vulnerability](fix-code-vulnerability.md), that instinct was correct — there were real findings (which CWE? which functions?). Here, the "findings" were "it's Ubuntu and nginx is installed," which the model already assumed.

The exploration wasn't wrong, exactly. It was just unnecessary for a task the model could already solve from memory. The weaver prompt encourages a pattern that doesn't always fit.

## The lesson

Weaver hurts on fast procedural tasks. When the agent already has the recipe — create repo, write hook, configure nginx, test — checkpoints and rewinds are pure overhead. There's nothing to explore, nothing to prune, nothing to correct.

This is the opposite end of the spectrum from [fix-code-vulnerability](fix-code-vulnerability.md). There, the agent didn't know the answer and had to discover it; the checkpoint captured the discovery and the rewind cleaned up the search. Here, the agent knew the answer before it started; the checkpoint captured nothing useful and the rewind deleted nothing wasteful.

The pattern emerges across tasks: weaver's value correlates with uncertainty. High uncertainty (what's the vulnerability? → explore, checkpoint, rewind, fix) = [weaver helps](fix-code-vulnerability.md). Low uncertainty (set up git+nginx → just do it) = weaver hurts. Medium uncertainty (write a regex → think and iterate) = [weaver is neutral](regex-log.md). The tool is most valuable exactly when the task is hardest to predict, which is also when you'd most want a safety net.
